// backend/src/marketplace/auth/services/marketplace-account.repository.ts
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  MarketplaceAccountModel,
  MarketplaceAccountDocument,
} from '../schemas/marketplace-account.schema';

/**
 * Persistência das contas de marketplace (multi-client).
 * Conexão default — é dado de marketplace/autopeças.
 *
 * NOTA: o Mongoose NÃO coage string→ObjectId em query para este schema
 * (model criado a partir de MarketplaceAccountSchema). Por isso normalizamos
 * o marketplaceId para ObjectId no boundary, conforme regra do CLAUDE.md.
 */
@Injectable()
export class MarketplaceAccountRepository {
  constructor(
    @InjectModel(MarketplaceAccountModel.name)
    private readonly model: Model<MarketplaceAccountDocument>,
  ) {}

  async findDefault(marketplaceId: string | Types.ObjectId): Promise<MarketplaceAccountModel | null> {
    return this.model
      .findOne({ marketplaceId: this.toObjectId(marketplaceId), isDefault: true })
      .lean()
      .exec();
  }

  async createDefaultIfAbsent(
    data: Partial<MarketplaceAccountModel>,
  ): Promise<MarketplaceAccountModel | null> {
    const existing = await this.findDefault(data.marketplaceId as string | Types.ObjectId);
    if (existing) return null;
    const created = await this.model.create({ ...data, isDefault: true });
    return created.toObject();
  }

  /** Primeira conta ativa do marketplace cujo `domains` inclui o domínio. */
  async findByDomain(
    marketplaceId: string | Types.ObjectId,
    domain: string,
  ): Promise<MarketplaceAccountModel | null> {
    return this.model
      .findOne({ marketplaceId: this.toObjectId(marketplaceId), domains: domain })
      .sort({ createdAt: 1 })
      .lean()
      .exec();
  }

  /** Cria uma conta não-default (ex: 2ª conta ML/Shopee do domínio geral). */
  async createAccount(data: Partial<MarketplaceAccountModel>): Promise<MarketplaceAccountModel> {
    const created = await this.model.create({ ...data, isDefault: false });
    return created.toObject();
  }

  /** Busca uma conta por id. */
  async findById(accountId: string | Types.ObjectId): Promise<MarketplaceAccountModel | null> {
    return this.model.findOne({ _id: this.toObjectId(accountId) } as any).lean().exec();
  }

  /** Persiste (substitui) o token OAuth de uma conta. Idempotente via $set. */
  async updateToken(accountId: string | Types.ObjectId, token: Record<string, any>): Promise<void> {
    await this.model.updateOne(
      { _id: this.toObjectId(accountId) } as any,
      { $set: { token } } as any,
    ).exec();
  }

  /** Normaliza para ObjectId no boundary; lança erro claro se inválido. */
  private toObjectId(id: string | Types.ObjectId): Types.ObjectId {
    if (id instanceof Types.ObjectId) return id;
    if (typeof id === 'string' && Types.ObjectId.isValid(id)) return new Types.ObjectId(id);
    throw new Error(`marketplaceId inválido para MarketplaceAccount: "${String(id)}"`);
  }
}
