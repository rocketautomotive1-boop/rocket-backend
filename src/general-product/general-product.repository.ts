// backend/src/general-product/general-product.repository.ts
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ProductModel, ProductDocument } from '../product/schemas/product.schema';

/** Domínio dos itens gerais no ProductModel unificado. */
const GENERAL_DOMAIN = 'general';

/**
 * Persistência de itens gerais (saúde, beleza, bebidas, alimentos) sobre o
 * ProductModel unificado (banco único). Todo registro carrega `domain:'general'`
 * e a identidade é o `barcode` (itens gerais não têm partNumber). Toda query
 * filtra por `domain:'general'` para nunca colidir com produtos de autopeças.
 * Sanitiza Decimal128/ObjectId no boundary (espelha ProductRepository.toDto).
 */
@Injectable()
export class GeneralProductRepository {
  constructor(
    @InjectModel(ProductModel.name)
    private readonly model: Model<ProductDocument>,
  ) {}

  async create(data: Partial<ProductModel>): Promise<ProductModel> {
    const doc = await this.model.create({ ...data, domain: GENERAL_DOMAIN });
    return this.toDto(doc)!;
  }

  async findByBarcode(barcode: string): Promise<ProductModel | null> {
    const doc = await this.model.findOne({ barcode, domain: GENERAL_DOMAIN }).lean().exec();
    return this.toDto(doc);
  }

  /**
   * Grava (ou cria) o rascunho de discovery para um barcode. Idempotente:
   * `$set` apenas em draftData; `$setOnInsert` garante barcode + domain ao criar.
   * Não sobrescreve campos definidos pelo usuário (name/price/etc).
   */
  async upsertDraftByBarcode(barcode: string, draftData: Record<string, any>): Promise<void> {
    await this.model.updateOne(
      { barcode, domain: GENERAL_DOMAIN },
      { $set: { draftData }, $setOnInsert: { barcode, domain: GENERAL_DOMAIN } },
      { upsert: true },
    ).exec();
  }

  /**
   * Upsert por barcode aplicando SOMENTE os campos do patch via `$set`.
   * NUNCA grava `draftData` (o draft é sugestão de leitura, intocável aqui) nem
   * sobrescreve `domain`/`barcode`. Campos monetários/peso são castados para
   * Decimal128 pelo schema do Mongoose. Retorna o documento atualizado/sanitizado.
   */
  async updateByBarcode(
    barcode: string,
    patch: Partial<ProductModel>,
  ): Promise<ProductModel | null> {
    // Defesa extra: jamais deixar draftData/barcode/domain entrar no $set.
    const { draftData, barcode: _b, domain: _d, ...safe } = (patch ?? {}) as Record<string, any>;

    const doc = await this.model
      .findOneAndUpdate(
        { barcode, domain: GENERAL_DOMAIN },
        { $set: safe, $setOnInsert: { barcode, domain: GENERAL_DOMAIN } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .lean()
      .exec();

    return this.toDto(doc);
  }

  private toDto(doc: any): ProductModel | null {
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
