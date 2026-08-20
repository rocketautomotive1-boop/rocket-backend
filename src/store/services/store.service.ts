import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { StoreModel, StoreDocument, MarketplaceAccountEntry, FiscalChannel } from '../schemas/store.schema';
import { StorePort } from '../ports/store.port';

/**
 * Cache in-process (write-through) das lojas — mesmo padrão do
 * MarketplaceConfigCacheService. Cardinalidade baixa e fixa, lida em todo
 * publish; invalidação explícita em toda escrita.
 */
@Injectable()
export class StoreService implements StorePort {
  private readonly logger = new Logger(StoreService.name);
  private byId: Map<string, StoreModel & { id: string }> | null = null;
  private byAccountKey: Map<string, string> | null = null;

  constructor(
    @InjectModel(StoreModel.name)
    private readonly storeModel: Model<StoreDocument>,
  ) {}

  invalidate(): void {
    this.byId = null;
    this.byAccountKey = null;
  }

  async findAll(): Promise<Array<StoreModel & { id: string }>> {
    const map = await this.ensureHydrated();
    return [...map.values()];
  }

  async findById(storeId: string): Promise<(StoreModel & { id: string }) | null> {
    if (!storeId || !Types.ObjectId.isValid(storeId)) return null;
    const map = await this.ensureHydrated();
    return map.get(String(storeId)) ?? null;
  }

  async findByName(name: string): Promise<(StoreModel & { id: string }) | null> {
    const map = await this.ensureHydrated();
    for (const store of map.values()) {
      if (store.name === name) return store;
    }
    return null;
  }

  /** Todas as contas mapeadas para `marketplaceTag` na loja. [] se loja/mapeamento ausente. */
  async resolveAccountIds(storeId: string | null | undefined, marketplaceTag: string): Promise<string[]> {
    if (!storeId) return [];
    const store = await this.findById(storeId);
    if (!store) return [];
    return (store.marketplaceAccounts ?? [])
      .filter((entry) => entry.marketplaceTag === marketplaceTag)
      .map((entry) => entry.accountId);
  }

  /** Primeira conta mapeada para `marketplaceTag` na loja, ou null. Para chamadores que só precisam de uma. */
  async resolveAccountId(storeId: string | null | undefined, marketplaceTag: string): Promise<string | null> {
    const accounts = await this.resolveAccountIds(storeId, marketplaceTag);
    return accounts[0] ?? null;
  }

  async create(name: string): Promise<StoreModel & { id: string }> {
    if (!name?.trim()) throw new BadRequestException('name é obrigatório.');
    const doc = await this.storeModel.create({ name: name.trim(), marketplaceAccounts: [] });
    this.invalidate();
    return { ...doc.toObject(), id: String(doc._id) };
  }

  async setMarketplaceAccount(storeId: string, marketplaceTag: string, accountId: string): Promise<void> {
    if (!Types.ObjectId.isValid(storeId)) throw new BadRequestException(`Loja inválida: ${storeId}`);
    const store = await this.storeModel.findById(storeId).exec();
    if (!store) throw new NotFoundException(`Loja ${storeId} não encontrada.`);
    const existing: MarketplaceAccountEntry[] = store.marketplaceAccounts ?? [];
    const alreadyPresent = existing.some(
      (entry) => entry.marketplaceTag === marketplaceTag && entry.accountId === accountId,
    );
    store.marketplaceAccounts = alreadyPresent ? existing : [...existing, { marketplaceTag, accountId }];
    store.markModified('marketplaceAccounts');
    await store.save();
    this.invalidate();
  }

  async removeMarketplaceAccount(storeId: string, marketplaceTag: string, accountId: string): Promise<void> {
    if (!Types.ObjectId.isValid(storeId)) throw new BadRequestException(`Loja inválida: ${storeId}`);
    const store = await this.storeModel.findById(storeId).exec();
    if (!store) throw new NotFoundException(`Loja ${storeId} não encontrada.`);
    store.marketplaceAccounts = (store.marketplaceAccounts ?? []).filter(
      (entry) => !(entry.marketplaceTag === marketplaceTag && entry.accountId === accountId),
    );
    store.markModified('marketplaceAccounts');
    await store.save();
    this.invalidate();
  }

  /** Loja dona da conta (marketplaceTag, accountId) — inverso de resolveAccountId(s). */
  async resolveStoreForAccount(marketplaceTag: string, accountId: string): Promise<(StoreModel & { id: string }) | null> {
    await this.ensureHydrated();
    const storeId = this.byAccountKey?.get(accountKey(marketplaceTag, accountId));
    if (!storeId) return null;
    return this.byId?.get(storeId) ?? null;
  }

  async resolveFiscalChannel(storeId: string, marketplaceTag: string, accountId: string): Promise<FiscalChannel | null> {
    const store = await this.findById(storeId);
    if (!store) return null;
    return (store.fiscalChannels ?? []).find(
      (c) => c.marketplaceTag === marketplaceTag && c.accountId === accountId,
    ) ?? null;
  }

  /**
   * Reserva atomicamente o próximo número de NFe para este canal fiscal.
   * findOneAndUpdate é single-document no MongoDB — seguro sob concorrência
   * entre workers do sync-queue sem lock adicional. Reserva ANTES de
   * montar/assinar/transmitir: se a SEFAZ rejeitar depois, o número fica
   * queimado (gap), que é o comportamento correto e exigido — número de NFe
   * rejeitada não é reaproveitável, só cancelável/inutilizável.
   */
  async reserveFiscalNumber(storeId: string, marketplaceTag: string, accountId: string): Promise<{ series: number; number: number }> {
    if (!Types.ObjectId.isValid(storeId)) throw new BadRequestException(`Loja inválida: ${storeId}`);
    const updated = await this.storeModel.findOneAndUpdate(
      { _id: storeId, fiscalChannels: { $elemMatch: { marketplaceTag, accountId } } },
      { $inc: { 'fiscalChannels.$.counter': 1 }, $set: { 'fiscalChannels.$.reservedAt': new Date() } },
      { new: true },
    ).lean().exec() as any;
    if (!updated) {
      throw new NotFoundException(
        `Canal fiscal não configurado para ${marketplaceTag}/${accountId} na loja ${storeId}.`,
      );
    }
    const channel: FiscalChannel = (updated.fiscalChannels ?? []).find(
      (c: FiscalChannel) => c.marketplaceTag === marketplaceTag && c.accountId === accountId,
    );
    this.invalidate();
    return { series: channel.series, number: channel.counter };
  }

  /**
   * Cria ou atualiza o canal fiscal (série/sellerId) desta loja para
   * (marketplaceTag, accountId). Rejeita série já usada por outra loja
   * ligada à mesma LegalEntity — a SEFAZ amarra série+número ao CNPJ
   * emissor, não ao canal de venda, então duas lojas da mesma empresa não
   * podem reutilizar a mesma série.
   */
  async setFiscalChannel(
    storeId: string,
    marketplaceTag: string,
    accountId: string,
    input: { series: number; marketplaceSellerId?: string },
  ): Promise<void> {
    if (!Types.ObjectId.isValid(storeId)) throw new BadRequestException(`Loja inválida: ${storeId}`);
    const store = await this.storeModel.findById(storeId).exec();
    if (!store) throw new NotFoundException(`Loja ${storeId} não encontrada.`);

    if (store.legalEntityId) {
      const conflict = await this.storeModel.findOne({
        _id: { $ne: store._id },
        legalEntityId: store.legalEntityId,
        fiscalChannels: { $elemMatch: { series: input.series } },
      }).lean().exec();
      if (conflict) {
        throw new BadRequestException(
          `Série ${input.series} já está em uso por outra loja (${conflict.name}) da mesma entidade legal.`,
        );
      }
    }

    const existing: FiscalChannel[] = store.fiscalChannels ?? [];
    const idx = existing.findIndex((c) => c.marketplaceTag === marketplaceTag && c.accountId === accountId);
    if (idx >= 0) {
      existing[idx] = { ...existing[idx], series: input.series, marketplaceSellerId: input.marketplaceSellerId ?? existing[idx].marketplaceSellerId };
    } else {
      existing.push({ marketplaceTag, accountId, series: input.series, counter: 0, marketplaceSellerId: input.marketplaceSellerId });
    }
    store.fiscalChannels = existing;
    store.markModified('fiscalChannels');
    await store.save();
    this.invalidate();
  }

  async setLegalEntity(storeId: string, legalEntityId: string): Promise<void> {
    if (!Types.ObjectId.isValid(storeId)) throw new BadRequestException(`Loja inválida: ${storeId}`);
    if (!Types.ObjectId.isValid(legalEntityId)) throw new BadRequestException(`Entidade legal inválida: ${legalEntityId}`);
    const store = await this.storeModel.findById(storeId).exec();
    if (!store) throw new NotFoundException(`Loja ${storeId} não encontrada.`);
    store.legalEntityId = new Types.ObjectId(legalEntityId);
    await store.save();
    this.invalidate();
  }

  private async ensureHydrated(): Promise<Map<string, StoreModel & { id: string }>> {
    if (this.byId) return this.byId;
    const docs = await this.storeModel.find().lean().exec();
    const byId = new Map<string, StoreModel & { id: string }>();
    const byAccountKey = new Map<string, string>();
    for (const raw of docs) {
      const id = String(raw._id);
      byId.set(id, Object.freeze({ ...raw, id }) as StoreModel & { id: string });
      for (const entry of raw.marketplaceAccounts ?? []) {
        byAccountKey.set(accountKey(entry.marketplaceTag, entry.accountId), id);
      }
    }
    this.byId = byId;
    this.byAccountKey = byAccountKey;
    this.logger.debug(`Store cache hidratado: ${byId.size} lojas`);
    return byId;
  }
}

function accountKey(marketplaceTag: string, accountId: string): string {
  return `${marketplaceTag}:${accountId}`;
}
