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
import { parseVehicleQuery, ParsedVehicleQuery } from '../../vehicle-shared/utils/vehicle-query-parser.util';
import { VehicleMarket, VehicleOrigin } from '../../vehicle-shared/types/vehicle.types';
import { VEHICLE_CONSTANTS } from '../../vehicle-shared/constants/vehicle.constants';

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
   * Upsert usado pelo importador do ML e pela curadoria manual. Registros já curados
   * manualmente (origin: manual) nunca são sobrescritos por uma reimportação do ML.
   */
  async upsertByCanonicalKey(dto: UpsertVehicleCompatibilityDto): Promise<VehicleCompatibilityDocument> {
    const incoming = this.buildEnrichedFields(dto);

    const existing = await this.model.findOne({ canonicalKey: incoming.canonicalKey }).lean().exec();

    if (!existing) {
      const created = await this.model.findOneAndUpdate(
        { canonicalKey: incoming.canonicalKey },
        { $setOnInsert: incoming },
        { upsert: true, new: true },
      ).exec();
      return created as VehicleCompatibilityDocument;
    }

    if (existing.origin === VehicleOrigin.MANUAL && incoming.origin === VehicleOrigin.ML_IMPORT) {
      this.logger.debug(`Skipping ML reimport over manually curated record: ${incoming.canonicalKey}`);
      return existing as VehicleCompatibilityDocument;
    }

    const mergedAliases = [...new Set([...(existing.aliases ?? []), ...(incoming.aliases ?? [])])].slice(0, 20);
    const mergedTags = [...new Set([...(existing.tags ?? []), ...(incoming.tags ?? [])])];

    const update: Record<string, any> = {
      ...incoming,
      aliases: mergedAliases,
      tags: mergedTags,
      dataQualityScore: Math.max(existing.dataQualityScore ?? 0, incoming.dataQualityScore),
    };

    const result = await this.model
      .findOneAndUpdate({ canonicalKey: incoming.canonicalKey }, { $set: update }, { new: true })
      .exec();

    this.logger.debug(`Upserted compatibility ${incoming.canonicalKey}`);
    return result as VehicleCompatibilityDocument;
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
    const doors = rawDimensions?.doors;

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
    };
  }
}
