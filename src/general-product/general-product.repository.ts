// backend/src/general-product/general-product.repository.ts
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { GENERAL_CONNECTION } from '../database/connections';
import { GeneralProductModel, GeneralProductDocument } from './schemas/general-product.schema';

/**
 * Persistência do domínio GeneralProduct na conexão `general` (Mongo B).
 * Sanitiza Decimal128/ObjectId no boundary (espelha ProductRepository.toDto).
 */
@Injectable()
export class GeneralProductRepository {
  constructor(
    @InjectModel(GeneralProductModel.name, GENERAL_CONNECTION)
    private readonly model: Model<GeneralProductDocument>,
  ) {}

  async create(data: Partial<GeneralProductModel>): Promise<GeneralProductModel> {
    const doc = await this.model.create(data);
    return this.toDto(doc);
  }

  async findByBarcode(barcode: string): Promise<GeneralProductModel | null> {
    const doc = await this.model.findOne({ barcode }).lean().exec();
    return this.toDto(doc);
  }

  /**
   * Grava (ou cria) o rascunho de discovery para um barcode. Idempotente:
   * `$set` apenas em draftData; `$setOnInsert` garante o barcode ao criar.
   * Não sobrescreve campos definidos pelo usuário (name/price/etc).
   */
  async upsertDraftByBarcode(barcode: string, draftData: Record<string, any>): Promise<void> {
    await this.model.updateOne(
      { barcode },
      { $set: { draftData }, $setOnInsert: { barcode } },
      { upsert: true },
    ).exec();
  }

  /**
   * Upsert por barcode aplicando SOMENTE os campos do patch via `$set`.
   * NUNCA grava `draftData` (o draft é sugestão de leitura, intocável aqui).
   * Campos monetários/peso são castados para Decimal128 pelo schema do Mongoose.
   * Retorna o documento atualizado e sanitizado.
   */
  async updateByBarcode(
    barcode: string,
    patch: Partial<GeneralProductModel>,
  ): Promise<GeneralProductModel | null> {
    // Defesa extra: jamais deixar draftData (ou o próprio barcode) entrar no $set.
    const { draftData, barcode: _ignored, ...safe } = (patch ?? {}) as Record<string, any>;

    const doc = await this.model
      .findOneAndUpdate(
        { barcode },
        { $set: safe, $setOnInsert: { barcode } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .lean()
      .exec();

    return this.toDto(doc);
  }

  private toDto(doc: any): GeneralProductModel | null {
    if (!doc) return null;
    const obj = typeof doc.toObject === 'function' ? doc.toObject() : doc;
    return this.sanitize(obj);
  }

  private sanitize(value: any): any {
    if (Array.isArray(value)) return value.map((v) => this.sanitize(v));
    if (value instanceof Types.ObjectId) return value.toString();
    if (value instanceof Types.Decimal128 || value?._bsontype === 'Decimal128') return value.toString();
    if (value?.$numberDecimal) return value.$numberDecimal;
    if (value && typeof value === 'object') {
      const out: any = {};
      for (const k of Object.keys(value)) out[k] = k === '_id' ? value[k]?.toString() : this.sanitize(value[k]);
      return out;
    }
    return value;
  }
}
