import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { VehicleCompatibilityDocument, VehicleCompatibilityModel } from '../schemas/vehicle-compatibility.schema';
import { ProductCompatibilityModel } from '../../product/schemas/product-compatibility.schema';
import { ProductModel } from '../../product/schemas/product.schema';
import { CreateVehicleCompatibilityDto } from '../dto/create-vehicle-compatibility.dto';
import { UpdateVehicleCompatibilityDto } from '../dto/update-vehicle-compatibility.dto';
import { SearchVehicleCompatibilitiesDto } from '../dto/search-vehicle-compatibilities.dto';
import { UpsertVehicleCompatibilityDto } from '../dto/upsert-vehicle-compatibility.dto';
import { ResolveVehicleDto } from '../dto/resolve-vehicle.dto';
import { VehicleCompatibilityFacetsDto } from '../dto/vehicle-compatibility-facets.dto';
import {
  VehicleCompatibilityInUseException,
  VehicleCompatibilityNotFoundException,
} from '../../vehicle-shared/exceptions/vehicle.exceptions';
import {
  buildSearchText,
  computeDataQualityScore,
  deriveAliases,
  extractCabType,
  extractEngineDisplay,
  extractTraction,
  extractTrim,
  generateCanonicalKey,
  generateEngineSignature,
  normalizeDisplacementCc,
  normalizeFuelTags,
  normalizeMake,
  normalizeModel,
  normalizeVersionDisplay,
} from '../../vehicle-shared/utils/vehicle-normalizer.util';
import { shouldReplaceSection } from './vehicle-section-merge.util';
import { parseVehicleQuery, ParsedVehicleQuery } from '../../vehicle-shared/utils/vehicle-query-parser.util';
import { VehicleMarket, VehicleOrigin } from '../../vehicle-shared/types/vehicle.types';
import { VEHICLE_CONSTANTS } from '../../vehicle-shared/constants/vehicle.constants';

/** Objeto/array vazio conta como ausente — mesma regra usada dentro do merge por seção. */
function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value as object).length === 0;
  return false;
}

@Injectable()
export class VehicleCompatibilityService {
  private readonly logger = new Logger(VehicleCompatibilityService.name);

  constructor(
    @InjectModel(VehicleCompatibilityModel.name)
    private readonly model: Model<VehicleCompatibilityDocument>,
    @InjectModel(ProductCompatibilityModel.name)
    private readonly productCompatibilityModel: Model<ProductCompatibilityModel>,
    @InjectModel(ProductModel.name)
    private readonly productModel: Model<ProductModel>,
  ) {}

  async create(dto: CreateVehicleCompatibilityDto): Promise<VehicleCompatibilityDocument> {
    const enriched = this.buildEnrichedFields({ ...dto, origin: dto.origin ?? VehicleOrigin.MANUAL });
    const doc = new this.model(enriched);
    return doc.save();
  }

  /**
   * Upsert usado pelos importadores (ML, FIPE, OEM) e pela curadoria manual.
   * Merge é por SEÇÃO, não por documento inteiro: cada seção rica (powertrain,
   * chassisAndDynamics, safetyAndAdas, equipment, warranty, colors, fipe, years)
   * só é sobrescrita se a fonte da seção entrante tem prioridade igual ou maior
   * que a da seção já salva E o valor entrante não é vazio — ver
   * vehicle-section-merge.util.ts para a tabela de prioridade completa.
   * 'manual' é a única exceção universal: sempre vence, em qualquer seção.
   */
  async upsertByCanonicalKey(dto: UpsertVehicleCompatibilityDto): Promise<VehicleCompatibilityDocument> {
    const incoming = this.buildEnrichedFields(dto);
    const incomingOrigin = incoming.origin;
    const fetchedAt = new Date();

    const existing = await this.model.findOne({ canonicalKey: incoming.canonicalKey }).lean().exec();

    if (!existing) {
      const created = await this.model.findOneAndUpdate(
        { canonicalKey: incoming.canonicalKey },
        { $setOnInsert: this.withProvenance(incoming, incomingOrigin, fetchedAt) },
        { upsert: true, new: true },
      ).exec();
      return created as VehicleCompatibilityDocument;
    }

    // Campos "core" fora de seção própria (make/model/version/dimensions/etc.)
    // seguem a mesma regra: manual sempre vence; caso contrário, fonte de
    // maior prioridade some o documento inteiro por enquanto (comportamento
    // do v1). Isso preserva o guard-rail histórico.
    if (existing.origin === VehicleOrigin.MANUAL && incomingOrigin !== VehicleOrigin.MANUAL) {
      this.logger.debug(`Skipping ${incomingOrigin} reimport over manually curated record: ${incoming.canonicalKey}`);
      return existing as VehicleCompatibilityDocument;
    }

    const mergedAliases = [...new Set([...(existing.aliases ?? []), ...(incoming.aliases ?? [])])].slice(0, 20);
    const mergedTags = [...new Set([...(existing.tags ?? []), ...(incoming.tags ?? [])])];

    const update: Record<string, any> = {
      ...incoming,
      aliases: mergedAliases,
      tags: mergedTags,
    };

    // Seções ricas v2: merge seção-a-seção em vez de sobrescrita cega.
    this.mergeRichSection(update, existing, incoming, 'powertrain', incomingOrigin, fetchedAt);
    this.mergeRichSection(update, existing, incoming, 'chassisAndDynamics', incomingOrigin, fetchedAt);
    this.mergeRichSection(update, existing, incoming, 'safetyAndAdas', incomingOrigin, fetchedAt);
    this.mergeRichSection(update, existing, incoming, 'equipment', incomingOrigin, fetchedAt);
    this.mergeRichSection(update, existing, incoming, 'warranty', incomingOrigin, fetchedAt);
    this.mergeColorsSection(update, existing, incoming, incomingOrigin, fetchedAt);
    this.mergeFipeSection(update, existing, incoming, incomingOrigin, fetchedAt);

    // dataQualityScore é recomputado sobre o documento PÓS-merge, não sobre o
    // incoming isolado — uma seção preservada da fonte anterior deve contar.
    update.dataQualityScore = computeDataQualityScore({
      make: update.make,
      model: update.model,
      version: update.version,
      years: update.years,
      displacementCc: update.displacementCc,
      fuelType: update.fuelType,
      transmission: update.transmission,
      bodyType: update.bodyType,
      platform: update.platform,
      fipe: update.fipe,
      aliases: mergedAliases,
    });

    const result = await this.model
      .findOneAndUpdate({ canonicalKey: incoming.canonicalKey }, { $set: update }, { new: true })
      .exec();

    this.logger.debug(`Upserted compatibility ${incoming.canonicalKey} (origin=${incomingOrigin})`);
    return result as VehicleCompatibilityDocument;
  }

  private withProvenance(
    incoming: Record<string, any>,
    origin: VehicleOrigin,
    fetchedAt: Date,
  ): Record<string, any> {
    const provenance = { sourceType: origin, fetchedAt, confidence: 'medium' as const };
    const result: Record<string, any> = { ...incoming, schemaVersion: 2 };
    for (const section of ['powertrain', 'chassisAndDynamics', 'safetyAndAdas', 'equipment', 'warranty']) {
      if (!isEmpty(incoming[section])) result[`${section}_provenance`] = provenance;
    }
    if (!isEmpty(incoming.exteriorColors) || !isEmpty(incoming.interiorColors)) {
      result.colors_provenance = provenance;
    }
    return result;
  }

  /** Aplica shouldReplaceSection para uma seção rica nomeada (powertrain, warranty, etc). */
  private mergeRichSection(
    update: Record<string, any>,
    existing: Record<string, any>,
    incoming: Record<string, any>,
    section: 'powertrain' | 'chassisAndDynamics' | 'safetyAndAdas' | 'equipment' | 'warranty',
    incomingOrigin: VehicleOrigin,
    fetchedAt: Date,
  ): void {
    const provenanceKey = `${section}_provenance`;
    const replace = shouldReplaceSection(
      section,
      { value: existing[section], provenance: existing[provenanceKey] },
      { value: incoming[section], provenance: { sourceType: incomingOrigin, fetchedAt } },
    );

    if (replace) {
      update[section] = incoming[section];
      update[provenanceKey] = { sourceType: incomingOrigin, fetchedAt, confidence: 'medium' };
      update.schemaVersion = 2;
    } else {
      update[section] = existing[section];
      update[provenanceKey] = existing[provenanceKey];
    }
  }

  private mergeColorsSection(
    update: Record<string, any>,
    existing: Record<string, any>,
    incoming: Record<string, any>,
    incomingOrigin: VehicleOrigin,
    fetchedAt: Date,
  ): void {
    const incomingHasColors = !isEmpty(incoming.exteriorColors) || !isEmpty(incoming.interiorColors);
    const replace = shouldReplaceSection(
      'colors',
      { value: existing.exteriorColors, provenance: existing.colors_provenance },
      { value: incomingHasColors ? incoming.exteriorColors ?? ['_has_colors_'] : undefined, provenance: { sourceType: incomingOrigin, fetchedAt } },
    );

    if (replace) {
      update.exteriorColors = incoming.exteriorColors;
      update.interiorColors = incoming.interiorColors;
      update.ownerBenefits = incoming.ownerBenefits;
      update.colors_provenance = { sourceType: incomingOrigin, fetchedAt, confidence: 'medium' };
    } else {
      update.exteriorColors = existing.exteriorColors;
      update.interiorColors = existing.interiorColors;
      update.ownerBenefits = existing.ownerBenefits;
      update.colors_provenance = existing.colors_provenance;
    }
  }

  private mergeFipeSection(
    update: Record<string, any>,
    existing: Record<string, any>,
    incoming: Record<string, any>,
    incomingOrigin: VehicleOrigin,
    fetchedAt: Date,
  ): void {
    const replace = shouldReplaceSection(
      'fipe',
      { value: existing.fipe?.code ? existing.fipe : undefined, provenance: existing.fipe_provenance },
      { value: incoming.fipe?.code ? incoming.fipe : undefined, provenance: { sourceType: incomingOrigin, fetchedAt } },
    );

    if (replace) {
      update.fipe = incoming.fipe;
      update.fipe_provenance = { sourceType: incomingOrigin, fetchedAt, confidence: 'medium' };
    } else if (existing.fipe) {
      update.fipe = existing.fipe;
      update.fipe_provenance = existing.fipe_provenance;
    }
  }

  async findById(id: string): Promise<VehicleCompatibilityDocument> {
    const doc = await this.model.findById(id).exec();
    if (!doc) throw new VehicleCompatibilityNotFoundException(id);
    return doc;
  }

  /** Busca em lote por _id, best-effort (ids inexistentes/inválidos são omitidos do resultado). */
  async findManyByIds(ids: string[]): Promise<VehicleCompatibilityDocument[]> {
    const validIds = [...new Set(ids)].filter((id) => Types.ObjectId.isValid(id));
    if (!validIds.length) return [];
    return this.model.find({ _id: { $in: validIds } }).lean().exec() as any;
  }

  async update(id: string, dto: UpdateVehicleCompatibilityDto): Promise<VehicleCompatibilityDocument> {
    const update: Record<string, any> = { ...dto, origin: VehicleOrigin.MANUAL, lastEditedAt: new Date() };
    const doc = await this.model.findByIdAndUpdate(id, { $set: update }, { new: true }).exec();
    if (!doc) throw new VehicleCompatibilityNotFoundException(id);
    return doc;
  }

  /**
   * Uso do veículo em product_compatibilities — base para bloquear exclusão (ver
   * docs/superpowers/specs/2026-07-15-admin-vehicle-crud-design.md). `products` é limitado para
   * exibição na UI; `count` é o total real.
   */
  async getUsage(id: string, limit = 20): Promise<{ count: number; products: Array<{ id: string; name: string }> }> {
    const count = await this.productCompatibilityModel.countDocuments({ vehicleId: id }).exec();
    if (count === 0) return { count: 0, products: [] };

    const rows = await this.productCompatibilityModel
      .find({ vehicleId: id })
      .select('product')
      .limit(limit)
      .lean()
      .exec();

    const productIds = [...new Set(rows.map((r: any) => String(r.product)).filter(Boolean))];
    const products = await this.productModel
      .find({ _id: { $in: productIds } })
      .select('name')
      .lean()
      .exec();

    return {
      count,
      products: products.map((p: any) => ({ id: String(p._id), name: p.name })),
    };
  }

  async deactivate(id: string): Promise<void> {
    const usage = await this.getUsage(id);
    if (usage.count > 0) throw new VehicleCompatibilityInUseException(usage.count, usage.products);

    const result = await this.model.updateOne({ _id: id }, { $set: { active: false } }).exec();
    if (result.matchedCount === 0) throw new VehicleCompatibilityNotFoundException(id);
  }

  async search(
    dto: SearchVehicleCompatibilitiesDto,
  ): Promise<{ data: VehicleCompatibilityDocument[]; total: number }> {
    const filter: Record<string, any> = {};

    if (dto.active !== undefined) filter.active = dto.active;
    if (dto.market) filter.market = dto.market;
    if (dto.bodyType) filter.bodyType = dto.bodyType;
    if (dto.year) filter.years = dto.year;
    if (dto.transmission) filter.transmission = dto.transmission;

    if (dto.make) filter.makeKey = normalizeMake(dto.make);
    if (dto.model) filter.modelKey = normalizeModel(dto.model);
    if (dto.version) filter.versionKey = normalizeVersionDisplay(dto.version);

    if (dto.q) {
      const parsed = parseVehicleQuery(dto.q);
      return this.atlasSearch(dto, parsed);
    }

    const skip = ((dto.page ?? 1) - 1) * (dto.limit ?? 20);
    const [data, total] = await Promise.all([
      this.model
        .find(filter)
        .sort({ dataQualityScore: -1, make: 1, model: 1, version: 1 })
        .skip(skip)
        .limit(dto.limit ?? 20)
        .lean()
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return { data: data as any, total };
  }

  /**
   * Resolve texto livre de veículo ("gol 1.6 2015 flex") a candidatos estruturados de
   * vehicle_compatibilities, para uso pela garagem do cliente (rocket-b2c) — diferente de
   * `search`, que serve a tela de curadoria interna e devolve o documento completo.
   */
  async resolve(dto: ResolveVehicleDto): Promise<{
    candidates: Array<{
      vehicleId: string;
      make: string;
      model: string;
      version: string;
      versionDisplay?: string;
      year?: number;
      fuelTags?: string[];
    }>;
  }> {
    const parsed = parseVehicleQuery(dto.q);
    const { data } = await this.atlasSearch({ q: dto.q, active: true, limit: dto.limit ?? 20 }, parsed);

    const candidates = data.map((doc: any) => ({
      vehicleId: String(doc._id),
      make: doc.make,
      model: doc.model,
      version: doc.version,
      versionDisplay: doc.versionDisplay,
      year: Array.isArray(doc.years) && doc.years.length > 0 ? Math.max(...doc.years) : undefined,
      fuelTags: doc.fuelTags,
    }));

    return { candidates };
  }

  async atlasSearch(
    dto: SearchVehicleCompatibilitiesDto,
    parsed?: ParsedVehicleQuery,
  ): Promise<{ data: VehicleCompatibilityDocument[]; total: number }> {
    const skip = ((dto.page ?? 1) - 1) * (dto.limit ?? 20);
    const limit = dto.limit ?? 20;
    const freeText = parsed?.freeText || dto.q;

    const queryTokens = (freeText ?? '').split(/\s+/).filter(Boolean);

    // Cada token da busca precisa aparecer em pelo menos um campo forte (make/model/version/
    // searchText) — evita que "Grand Vitara" retorne veículos que só batem em "grand" OU
    // "vitara" isoladamente via aliases/tags/fuzzy. Esses campos fracos só ajustam o ranking.
    const tokenMustClauses = queryTokens.map((token) => ({
      compound: {
        should: [
          { text: { query: token, path: 'makeKey', score: { boost: { value: 5 } } } },
          { text: { query: token, path: 'modelKey', score: { boost: { value: 5 } } } },
          { text: { query: token, path: 'versionKey', score: { boost: { value: 3 } } } },
          { text: { query: token, path: 'searchText', score: { boost: { value: 1 } } } },
        ],
        minimumShouldMatch: 1,
      },
    }));

    const searchStage: any = {
      $search: {
        index: 'vehicle_compatibility_search',
        compound: {
          must: tokenMustClauses,
          should: [
            { text: { query: freeText, path: 'aliases', score: { boost: { value: 2 } } } },
            { text: { query: freeText, path: 'tags', score: { boost: { value: 1 } } } },
            { text: { query: freeText, path: 'searchText', fuzzy: { maxEdits: 1 }, score: { boost: { value: 1 } } } },
          ],
          filter: [],
        },
      },
    };

    if (dto.active !== undefined) {
      searchStage.$search.compound.filter.push({ equals: { path: 'active', value: dto.active } });
    }
    if (dto.year) {
      searchStage.$search.compound.filter.push({ equals: { path: 'years', value: dto.year } });
    }
    if (dto.market) {
      searchStage.$search.compound.filter.push({ text: { path: 'market', query: dto.market } });
    }
    if (parsed?.yearRange) {
      searchStage.$search.compound.filter.push({
        range: { path: 'years', gte: parsed.yearRange.from, lte: parsed.yearRange.to },
      });
    }
    if (parsed?.fuelTags?.length) {
      searchStage.$search.compound.filter.push({
        in: { path: 'fuelTags', value: parsed.fuelTags },
      });
    }
    if (parsed?.engineDisplay !== undefined) {
      searchStage.$search.compound.filter.push({
        equals: { path: 'engineDisplay', value: parsed.engineDisplay },
      });
    }
    if (parsed?.powerHp !== undefined) {
      searchStage.$search.compound.filter.push({
        range: { path: 'engine.powerHp', gte: parsed.powerHp - 2, lte: parsed.powerHp + 2 },
      });
    }

    try {
      const result = await this.model.aggregate([
        searchStage,
        {
          $facet: {
            data: [{ $skip: skip }, { $limit: limit }],
            meta: [{ $count: 'total' }],
          },
        },
      ]).exec();

      const data = result?.[0]?.data ?? [];
      const total = result?.[0]?.meta?.[0]?.total ?? 0;
      return { data, total };
    } catch (err) {
      this.logger.warn(`Atlas Search unavailable, falling back to text search: ${err?.message}`);
      const filter: any = { $text: { $search: freeText } };
      if (dto.active !== undefined) filter.active = dto.active;
      if (dto.market) filter.market = dto.market;
      if (dto.year) filter.years = dto.year;
      if (parsed?.yearRange) {
        filter.years = { $elemMatch: { $gte: parsed.yearRange.from, $lte: parsed.yearRange.to } };
      }
      if (parsed?.fuelTags?.length) {
        filter.fuelTags = { $in: parsed.fuelTags };
      }
      if (parsed?.engineDisplay !== undefined) {
        filter.engineDisplay = parsed.engineDisplay;
      }
      if (parsed?.powerHp !== undefined) {
        filter['engine.powerHp'] = { $gte: parsed.powerHp - 2, $lte: parsed.powerHp + 2 };
      }

      const [data, total] = await Promise.all([
        this.model
          .find(filter)
          .sort({ score: { $meta: 'textScore' } })
          .skip(skip)
          .limit(limit)
          .lean()
          .exec(),
        this.model.countDocuments(filter).exec(),
      ]);
      return { data: data as any, total };
    }
  }

  /**
   * Facets em cascata p/ dropdowns de filtro estruturado (marca→modelo→ano→carroceria→câmbio):
   * cada faceta é escopada pelos filtros já escolhidos EXCETO ela mesma, senão selecionar uma
   * marca zeraria a própria lista de marcas na próxima chamada.
   */
  async getFacets(dto: VehicleCompatibilityFacetsDto): Promise<{
    makes: Array<{ value: string; count: number }>;
    models: Array<{ value: string; count: number }>;
    years: Array<{ value: number; count: number }>;
    bodyTypes: Array<{ value: string; count: number }>;
    transmissions: Array<{ value: string; count: number }>;
  }> {
    const active = dto.active ?? true;
    const baseFilter: Record<string, any> = { active };
    if (dto.make) baseFilter.makeKey = normalizeMake(dto.make);
    if (dto.model) baseFilter.modelKey = normalizeModel(dto.model);
    if (dto.year) baseFilter.years = dto.year;
    if (dto.bodyType) baseFilter.bodyType = dto.bodyType;
    if (dto.transmission) baseFilter.transmission = dto.transmission;

    const filterWithout = (key: keyof typeof baseFilter) => {
      const { [key]: _omit, ...rest } = baseFilter;
      return rest;
    };

    const countBy = (field: string, filter: Record<string, any>, unwind = false): any[] => [
      { $match: filter },
      ...(unwind ? [{ $unwind: `$${field}` }] : []),
      { $match: { [field]: { $ne: null } } },
      { $group: { _id: `$${field}`, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $project: { _id: 0, value: '$_id', count: 1 } },
    ];

    const result = await this.model
      .aggregate<any>([
        {
          $facet: {
            makes: countBy('make', filterWithout('makeKey')),
            models: countBy('model', filterWithout('modelKey')),
            years: countBy('years', filterWithout('years'), true),
            bodyTypes: countBy('bodyType', filterWithout('bodyType')),
            transmissions: countBy('transmission', filterWithout('transmission'), true),
          } as any,
        },
      ])
      .exec();

    return {
      makes: result?.[0]?.makes ?? [],
      models: result?.[0]?.models ?? [],
      years: result?.[0]?.years ?? [],
      bodyTypes: result?.[0]?.bodyTypes ?? [],
      transmissions: result?.[0]?.transmissions ?? [],
    };
  }

  private buildEnrichedFields(
    dto: CreateVehicleCompatibilityDto & { origin?: VehicleOrigin; mlVehicleId?: string },
  ): Partial<VehicleCompatibilityModel> & { canonicalKey: string; origin: VehicleOrigin } {
    const market = dto.market ?? VehicleMarket.BR;
    const allAliases = [
      ...(dto.aliases ?? []),
      ...deriveAliases(dto.make, dto.model, dto.version, dto.years ?? []),
    ]
      .map((v) => v.toLowerCase().trim())
      .filter((v) => v.length > 2);

    const tags = [...new Set((dto.tags ?? []).map((v) => v.toLowerCase().trim()))];

    const rawEngine = dto.engine as any;
    const rawDimensions = (dto as any).dimensions;

    const displacementCc = normalizeDisplacementCc(rawEngine?.displacement);
    const fuelType = rawEngine?.fuelType;
    // dto.doors (top-level) é o formato v2 (importadores OEM mandam assim,
    // já que `doors` não é uma "dimensão física" propriamente); dimensions.doors
    // é o formato legado do ML, mantido como fallback para não quebrar imports existentes.
    const doors = (dto as any).doors ?? rawDimensions?.doors;

    const canonicalKey = `${VEHICLE_CONSTANTS.CANONICAL_VERSION}:${generateCanonicalKey(
      dto.make,
      dto.model,
      dto.version,
      generateEngineSignature({ displacementCc, fuelType }),
      market,
      dto.years,
    )}`;

    const dataQualityScore = computeDataQualityScore({
      make: dto.make,
      model: dto.model,
      version: dto.version,
      years: dto.years,
      displacementCc,
      fuelType,
      transmission: dto.transmission,
      bodyType: dto.bodyType,
      platform: dto.platform,
      fipe: dto.fipe as any,
      aliases: allAliases,
    });

    return {
      make: dto.make,
      model: dto.model,
      version: dto.version,
      versionDisplay: dto.versionDisplay ?? normalizeVersionDisplay(dto.version),
      makeKey: normalizeMake(dto.make),
      modelKey: normalizeModel(dto.model),
      versionKey: normalizeVersionDisplay(dto.version),
      market,
      engineDisplay: extractEngineDisplay(dto.version),
      displacementCc,
      fuelType,
      fuelTags: normalizeFuelTags(fuelType),
      engine: rawEngine?.powerHp !== undefined ? { powerHp: rawEngine.powerHp } : undefined,
      transmission: dto.transmission,
      years: dto.years,
      doors,
      trim: extractTrim(dto.version),
      traction: extractTraction(dto.version),
      cabType: extractCabType(dto.version),
      bodyType: dto.bodyType,
      dimensions: rawDimensions
        ? {
            fuelCapacityL: rawDimensions.fuelCapacityL,
            heightMm: rawDimensions.heightMm,
            lengthMm: rawDimensions.lengthMm,
            passengerCapacity: rawDimensions.passengerCapacity,
            wheelbaseMm: rawDimensions.wheelbaseMm,
            widthMm: rawDimensions.widthMm,
          }
        : undefined,
      platform: dto.platform,
      generation: dto.generation,
      facelift: dto.facelift,
      segment: dto.segment,
      fipe: dto.fipe as any,
      features: (dto as any).features,
      aliases: [...new Set(allAliases)].slice(0, 20),
      tags,
      searchText: buildSearchText(dto.make, dto.model, dto.version, allAliases, tags),
      canonicalKey,
      dataQualityScore,
      active: dto.active ?? true,
      origin: dto.origin ?? VehicleOrigin.MANUAL,
      mlVehicleId: dto.mlVehicleId,
      // v2: seções ricas repassadas como vieram — o merge por seção em
      // upsertByCanonicalKey decide o que sobrevive contra o documento existente.
      powertrain: (dto as any).powertrain,
      chassisAndDynamics: (dto as any).chassisAndDynamics,
      safetyAndAdas: (dto as any).safetyAndAdas,
      equipment: (dto as any).equipment,
      warranty: (dto as any).warranty,
      exteriorColors: (dto as any).exteriorColors,
      interiorColors: (dto as any).interiorColors,
      ownerBenefits: (dto as any).ownerBenefits,
    };
  }
}
