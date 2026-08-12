import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { StoreModel, StoreDocument, MarketplaceAccountEntry } from '../schemas/store.schema';
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
