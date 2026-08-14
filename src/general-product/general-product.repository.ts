// backend/src/general-product/general-product.repository.ts
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ProductModel, ProductDocument } from '../product/schemas/product.schema';
import { buildUniqueProductSlug } from '../product/utils/product-slug.util';
import { ProductShortTitleService } from '../product/services/product-short-title.service';

/** Domínio dos itens gerais no ProductModel unificado. */
const GENERAL_DOMAIN = 'general';

/**
 * Produto geral lido do banco. Espelha o runtime do `toDto`: o documento `.lean()`
 * sempre carrega `_id` (sanitizado para string no boundary), que `ProductModel`
 * (classe do schema) não declara. Tipar aqui evita acessos `as any` nos callers.
 */
export type GeneralProductDto = ProductModel & { _id: string };

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
    private readonly shortTitleService: ProductShortTitleService,
  ) {}

  async create(data: Partial<ProductModel>): Promise<GeneralProductDto> {
    const doc = await this.model.create({ ...data, domain: GENERAL_DOMAIN });
    return this.toDto(doc)!;
  }

  async findByBarcode(barcode: string): Promise<GeneralProductDto | null> {
    const doc = await this.model.findOne({ barcode, domain: GENERAL_DOMAIN }).lean().exec();
    return this.toDto(doc);
  }

  /**
   * Garante um Product `domain:'general'` para o barcode (cria um shell se não
   * existir) e retorna o `_id`. Usado na identificação por barcode antes de
   * navegar para o stepper. Idempotente; não toca campos já preenchidos.
   * `name` é required no ProductModel → placeholder no insert (atualizado depois
   * pelo discovery/usuário).
   */
  async ensureByBarcode(barcode: string): Promise<{ productId: string }> {
    const doc = await this.model
      .findOneAndUpdate(
        { barcode, domain: GENERAL_DOMAIN },
        { $setOnInsert: { barcode, domain: GENERAL_DOMAIN, name: `Item ${barcode}` } },
        { upsert: true, new: true },
      )
      .lean()
      .exec();
    return { productId: String(doc!._id) };
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
  ): Promise<GeneralProductDto | null> {
    // Defesa extra: jamais deixar draftData/barcode/domain entrar no $set.
    const { draftData, barcode: _b, domain: _d, title, ...safe } = (patch ?? {}) as Record<string, any>;

    // `title` (texto) resolve/cria um ProductShortTitle reutilizável, igual ao fluxo de
    // autopeças (ProductService.update) — mesmo padrão de sinônimo/reuso entre domínios.
    if (title) {
      const shortTitle = await this.shortTitleService.createOrGet(title);
      safe.titleId = shortTitle._id;
      safe.titleText = shortTitle.text;
      safe.titleSynonyms = shortTitle.synonyms;
    }

    // Itens gerais nascem sem nome real (ensureByBarcode só sabe o barcode), então
    // slug só ganha sentido quando titleText/name chega pela primeira vez aqui —
    // regenerar sempre que um dos dois mudar mantém a URL alinhada ao nome atual.
    if (safe.titleText !== undefined || safe.name !== undefined) {
      const existing = await this.model.findOne({ barcode, domain: GENERAL_DOMAIN }).lean().exec();
      const nextTitleText = safe.titleText !== undefined ? safe.titleText : existing?.titleText;
      const nextSubtitle = safe.subtitle !== undefined ? safe.subtitle : existing?.subtitle;
      const nextName = safe.name !== undefined ? safe.name : existing?.name;
      if (nextTitleText || nextName) {
        safe.slug = await buildUniqueProductSlug(
          { titleText: nextTitleText, subtitle: nextSubtitle, name: nextName, barcode },
          async (candidate) => !!(await this.model.findOne({ slug: candidate, barcode: { $ne: barcode } })),
        );
      }
    }

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

  private toDto(doc: any): GeneralProductDto | null {
    if (!doc) return null;
    const obj = typeof doc.toObject === 'function' ? doc.toObject() : doc;
    return this.sanitize(obj) as GeneralProductDto;
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
