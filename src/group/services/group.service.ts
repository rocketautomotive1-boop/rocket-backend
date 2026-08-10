import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { GroupModel, GroupDocument } from '../schemas/group.schema';

/**
 * Cache in-process (write-through) dos grupos/lojas — mesmo padrão do
 * MarketplaceConfigCacheService. Cardinalidade baixa e fixa, lida em todo
 * publish; invalidação explícita em toda escrita.
 */
@Injectable()
export class GroupService {
  private readonly logger = new Logger(GroupService.name);
  private byId: Map<string, GroupModel & { id: string }> | null = null;

  constructor(
    @InjectModel(GroupModel.name)
    private readonly groupModel: Model<GroupDocument>,
  ) {}

  invalidate(): void {
    this.byId = null;
  }

  async findAll(): Promise<Array<GroupModel & { id: string }>> {
    const map = await this.ensureHydrated();
    return [...map.values()];
  }

  async findById(groupId: string): Promise<(GroupModel & { id: string }) | null> {
    if (!groupId || !Types.ObjectId.isValid(groupId)) return null;
    const map = await this.ensureHydrated();
    return map.get(String(groupId)) ?? null;
  }

  /** accountId mapeado para `marketplaceTag` no grupo. null se grupo/mapeamento ausente. */
  async resolveAccountId(groupId: string | null | undefined, marketplaceTag: string): Promise<string | null> {
    if (!groupId) return null;
    const group = await this.findById(groupId);
    if (!group) return null;
    return group.accounts?.[marketplaceTag] ?? null;
  }

  async setMarketplaceAccount(groupId: string, marketplaceTag: string, accountId: string): Promise<void> {
    if (!Types.ObjectId.isValid(groupId)) throw new BadRequestException(`Grupo inválido: ${groupId}`);
    const group = await this.groupModel.findById(groupId).exec();
    if (!group) throw new NotFoundException(`Grupo ${groupId} não encontrado.`);
    group.accounts = { ...(group.accounts ?? {}), [marketplaceTag]: accountId };
    group.markModified('accounts');
    await group.save();
    this.invalidate();
  }

  private async ensureHydrated(): Promise<Map<string, GroupModel & { id: string }>> {
    if (this.byId) return this.byId;
    const docs = await this.groupModel.find().lean().exec();
    const byId = new Map<string, GroupModel & { id: string }>();
    for (const raw of docs) {
      byId.set(String(raw._id), Object.freeze({ ...raw, id: String(raw._id) }) as GroupModel & { id: string });
    }
    this.byId = byId;
    this.logger.debug(`Group cache hidratado: ${byId.size} grupos`);
    return byId;
  }
}
