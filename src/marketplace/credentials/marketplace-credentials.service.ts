import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { MarketplaceModel, MarketplaceDocument } from '../schemas/marketplace.schema';
import { encrypt, decrypt, isEncrypted } from './credentials-crypto.helper';

interface CacheEntry {
  values: Record<string, string>;
  expiresAt: number;
}

const CACHE_TTL_MS = 60 * 1000;
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [100, 300, 1000];

/**
 * Fonte única de credenciais semi-estáticas (clientId, clientSecret, partnerKey, etc).
 *
 * Resolução: DB (encrypted) → env fallback (MP_<TAG>_<KEY>) → undefined.
 * Cache em memória 60s. Invalidação explícita via `invalidate(marketplaceId)`.
 * Retry transparente em erros transientes do Mongo (3 tentativas, backoff 100/300/1000ms).
 *
 * Adapters devem injetar este service e chamar get/getAll — nunca ler `process.env` diretamente.
 */
@Injectable()
export class MarketplaceCredentialsService {
  private readonly logger = new Logger(MarketplaceCredentialsService.name);
  private cache = new Map<string, CacheEntry>();

  constructor(
    @InjectModel(MarketplaceModel.name)
    private marketplaceModel: Model<MarketplaceDocument>,
  ) {}

  /**
   * Retorna o valor de uma credencial.
   * @param marketplaceId ObjectId do marketplace OU tag (ex: 'shopee', 'mercado-livre')
   * @param key chave da credencial (ex: 'partnerKey', 'clientSecret')
   * @returns valor descriptografado, ou undefined se ausente em DB e env
   */
  async get(marketplaceId: string, key: string): Promise<string | undefined> {
    const all = await this.getAll(marketplaceId);
    return all[key];
  }

  /**
   * Igual a get(), mas lança NotFoundException se a credencial não existir.
   */
  async getRequired(marketplaceId: string, key: string): Promise<string> {
    const value = await this.get(marketplaceId, key);
    if (!value) {
      throw new NotFoundException(
        `Credencial '${key}' não configurada para marketplace ${marketplaceId}. ` +
          `Configure via POST /marketplace-auth/:id/credentials ou defina MP_<TAG>_${key.toUpperCase()} no .env.`,
      );
    }
    return value;
  }

  /**
   * Retorna todas as credenciais resolvidas (DB + env fallback).
   */
  async getAll(marketplaceId: string): Promise<Record<string, string>> {
    const cacheKey = String(marketplaceId);
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.values;
    }

    const marketplace = await this.findMarketplaceWithRetry(marketplaceId);
    if (!marketplace) {
      throw new NotFoundException(`Marketplace ${marketplaceId} não encontrado.`);
    }

    const fromDb = this.decryptAll((marketplace as any).credentials || {});
    const fromEnv = this.readEnvFallback(marketplace.tag || marketplace.name);

    // DB tem precedência sobre env
    const merged: Record<string, string> = { ...fromEnv, ...fromDb };

    this.cache.set(cacheKey, {
      values: merged,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    // Espelho do cache por tag também (adapters podem passar tag)
    if (marketplace.tag && marketplace.tag !== cacheKey) {
      this.cache.set(marketplace.tag, {
        values: merged,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
    }

    return merged;
  }

  /**
   * Atualiza uma credencial individual. Criptografa + persiste + invalida cache.
   */
  async set(marketplaceId: string, key: string, value: string): Promise<void> {
    if (!value) throw new Error('Valor da credencial não pode ser vazio.');
    const encrypted = encrypt(value);
    await this.marketplaceModel.updateOne(
      { _id: this.toObjectId(marketplaceId) },
      { $set: { [`credentials.${key}`]: encrypted } },
    );
    this.invalidate(marketplaceId);
  }

  /**
   * Atualiza várias credenciais de uma vez.
   */
  async setAll(marketplaceId: string, creds: Record<string, string>): Promise<void> {
    const encrypted: Record<string, string> = {};
    for (const [k, v] of Object.entries(creds)) {
      if (!v) continue;
      encrypted[`credentials.${k}`] = encrypt(v);
    }
    if (Object.keys(encrypted).length === 0) return;
    await this.marketplaceModel.updateOne(
      { _id: this.toObjectId(marketplaceId) },
      { $set: encrypted },
    );
    this.invalidate(marketplaceId);
  }

  /**
   * Remove uma credencial.
   */
  async unset(marketplaceId: string, key: string): Promise<void> {
    await this.marketplaceModel.updateOne(
      { _id: this.toObjectId(marketplaceId) },
      { $unset: { [`credentials.${key}`]: '' } },
    );
    this.invalidate(marketplaceId);
  }

  /**
   * Invalida cache do marketplace (usar após rotação de chave detectada por erro de assinatura).
   */
  invalidate(marketplaceId: string): void {
    const id = String(marketplaceId);
    this.cache.delete(id);
    // Limpa entradas por tag também — varremos pois não temos mapeamento reverso barato
    for (const [k, v] of this.cache.entries()) {
      if (v.expiresAt < Date.now()) this.cache.delete(k);
    }
    // Em ambiente multi-instância, cache eventual converge via TTL de 60s
  }

  /**
   * Retorna lista de keys disponíveis (para o controller admin).
   */
  async listKeys(marketplaceId: string): Promise<string[]> {
    const all = await this.getAll(marketplaceId);
    return Object.keys(all);
  }

  // -- internals --

  private decryptAll(stored: Record<string, string>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(stored)) {
      if (!v) continue;
      try {
        result[k] = isEncrypted(v) ? decrypt(v) : v;
      } catch (e: any) {
        this.logger.error(
          `Falha ao descriptografar credencial '${k}': ${e.message}. ` +
            `Verifique MP_CRYPTO_KEY ou se o valor foi salvo com outra chave.`,
        );
        // Não inclui credencial corrompida no resultado — caller verá undefined e lançará NotFound
      }
    }
    return result;
  }

  private readEnvFallback(tag: string): Record<string, string> {
    if (!tag) return {};
    const prefix = `MP_${this.normalizeTag(tag)}_`;
    const result: Record<string, string> = {};
    for (const [envKey, envValue] of Object.entries(process.env)) {
      if (!envKey.startsWith(prefix) || !envValue) continue;
      const credKey = this.envKeyToCredKey(envKey.slice(prefix.length));
      result[credKey] = envValue;
    }
    return result;
  }

  private normalizeTag(tag: string): string {
    return tag.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  }

  private envKeyToCredKey(envSuffix: string): string {
    // SNAKE_UPPER → camelCase: PARTNER_KEY → partnerKey
    return envSuffix
      .toLowerCase()
      .split('_')
      .map((part, i) => (i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
      .join('');
  }

  private toObjectId(id: string): Types.ObjectId | string {
    if (Types.ObjectId.isValid(id) && /^[0-9a-fA-F]{24}$/.test(id)) {
      return new Types.ObjectId(id);
    }
    return id;
  }

  private async findMarketplaceWithRetry(
    marketplaceIdOrTag: string,
  ): Promise<MarketplaceDocument | null> {
    let lastError: any;
    for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt++) {
      try {
        return await this.findMarketplace(marketplaceIdOrTag);
      } catch (err: any) {
        lastError = err;
        if (!this.isTransientError(err) || attempt === MAX_RETRY_ATTEMPTS - 1) break;
        const delay = RETRY_BACKOFF_MS[attempt];
        this.logger.warn(
          `Mongo transient error on credentials lookup (attempt ${attempt + 1}/${MAX_RETRY_ATTEMPTS}): ${err.message}. Retrying in ${delay}ms.`,
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw lastError;
  }

  private async findMarketplace(idOrTag: string): Promise<MarketplaceDocument | null> {
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(idOrTag);
    if (isObjectId) {
      return this.marketplaceModel.findById(idOrTag).exec();
    }
    return this.marketplaceModel.findOne({ $or: [{ tag: idOrTag }, { name: idOrTag }] }).exec();
  }

  private isTransientError(err: any): boolean {
    if (!err) return false;
    const msg = String(err.message || '').toLowerCase();
    return (
      err.name === 'MongoNetworkError' ||
      err.name === 'MongoServerSelectionError' ||
      err.code === 'ECONNRESET' ||
      err.code === 'ETIMEDOUT' ||
      msg.includes('topology was destroyed') ||
      msg.includes('connection closed')
    );
  }
}
