import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { StoreModel, StoreDocument } from '../schemas/store.schema';

/**
 * Cache in-process (write-through) das lojas — mesmo padrão do
 * MarketplaceConfigCacheService. Cardinalidade baixa e fixa, lida em todo
 * publish; invalidação explícita em toda escrita.
 */
@Injectable()
export class StoreService {
  private readonly logger = new Logger(StoreService.name);
  private byId: Map<string, StoreModel & { id: string }> | null = null;

  constructor(
    @InjectModel(StoreModel.name)
    private readonly storeModel: Model<StoreDocument>,
  ) {}

  invalidate(): void {
    this.byId = null;
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

  /** accountId mapeado para `marketplaceTag` na loja. null se loja/mapeamento ausente. */
  async resolveAccountId(storeId: string | null | undefined, marketplaceTag: string): Promise<string | null> {
    if (!storeId) return null;
    const store = await this.findById(storeId);
    if (!store) return null;
    return store.accounts?.[marketplaceTag] ?? null;
  }

  async create(name: string): Promise<StoreModel & { id: string }> {
    if (!name?.trim()) throw new BadRequestException('name é obrigatório.');
    const doc = await this.storeModel.create({ name: name.trim(), accounts: {} });
    this.invalidate();
    return { ...doc.toObject(), id: String(doc._id) };
  }

  async setMarketplaceAccount(storeId: string, marketplaceTag: string, accountId: string): Promise<void> {
    if (!Types.ObjectId.isValid(storeId)) throw new BadRequestException(`Loja inválida: ${storeId}`);
    const store = await this.storeModel.findById(storeId).exec();
    if (!store) throw new NotFoundException(`Loja ${storeId} não encontrada.`);
    store.accounts = { ...(store.accounts ?? {}), [marketplaceTag]: accountId };
    store.markModified('accounts');
    await store.save();
    this.invalidate();
  }

  async removeMarketplaceAccount(storeId: string, marketplaceTag: string): Promise<void> {
    if (!Types.ObjectId.isValid(storeId)) throw new BadRequestException(`Loja inválida: ${storeId}`);
    const store = await this.storeModel.findById(storeId).exec();
    if (!store) throw new NotFoundException(`Loja ${storeId} não encontrada.`);
    const accounts = { ...(store.accounts ?? {}) };
    delete accounts[marketplaceTag];
    store.accounts = accounts;
    store.markModified('accounts');
    await store.save();
    this.invalidate();
  }

  private async ensureHydrated(): Promise<Map<string, StoreModel & { id: string }>> {
    if (this.byId) return this.byId;
    const docs = await this.storeModel.find().lean().exec();
    const byId = new Map<string, StoreModel & { id: string }>();
    for (const raw of docs) {
      byId.set(String(raw._id), Object.freeze({ ...raw, id: String(raw._id) }) as StoreModel & { id: string });
    }
    this.byId = byId;
    this.logger.debug(`Store cache hidratado: ${byId.size} lojas`);
    return byId;
  }
}
