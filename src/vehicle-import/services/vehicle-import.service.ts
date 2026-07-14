import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MercadoLivreCompatibilityAdapter } from '../../marketplace/adapters/mercado-livre/mercado-livre-compatibility.adapter';
import { VehicleCompatibilityService } from '../../vehicle-compatibility/services/vehicle-compatibility.service';
import { VehicleMarket, VehicleOrigin } from '../../vehicle-shared/types/vehicle.types';
import { VehicleImportBlocklistModel } from '../schemas/vehicle-import-blocklist.schema';

interface TopValue {
  id: string;
  name: string;
  metric?: number;
}

interface KnownAttribute {
  id: string;
  value_id: string;
}

interface CatalogAttribute {
  id: string;
  value_id?: string;
  value_name?: string;
}

interface CatalogProduct {
  id: string;
  attributes: CatalogAttribute[];
}

export interface VehicleImportResult {
  brandsProcessed: number;
  modelsProcessed: number;
  yearsSkippedNoMetric: number;
  productsFound: number;
  vehiclesUpserted: number;
  errors: number;
  durationMs: number;
}

/** Numéricos "123 cc" / "71 hp" / "3596 mm" / "47 L" / "3" -> número puro. */
function parseNumeric(raw?: string): number | undefined {
  if (!raw) return undefined;
  const match = raw.replace(',', '.').match(/-?\d+(\.\d+)?/);
  if (!match) return undefined;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * ENGINE_DISPLACEMENT vem em dois formatos inconsistentes na ML: "1000 cc" (cc explícito)
 * ou um número puro tipo "6.3" (litros, sem unidade — mesmo formato do atributo ENGINE).
 * Normaliza sempre para cc: se o texto já contém "cc", usa o valor direto; senão, assume
 * litros (valor pequeno, tipicamente < 20) e multiplica por 1000.
 */
function parseDisplacementCc(raw?: string): number | undefined {
  if (!raw) return undefined;
  const value = parseNumeric(raw);
  if (value === undefined) return undefined;
  return /cc/i.test(raw) ? value : value * 1000;
}

const HAS_FEATURE_PREFIX = 'HAS_';

/**
 * Limiar mínimo de `metric` (uso real reportado pela ML) para um ano entrar na importação.
 * Descarta só anos "fantasma" (metric 0 — placeholder/futuro sem nenhuma venda associada).
 * Um limiar mais alto (testado: 50) também corta modelos antigos legítimos e de baixo volume
 * (confirmado: Fiat Stilo 2003-2011, todos com metric 5-40) — não dá para distinguir "carro
 * raro" de "erro de cadastro" só pelo metric do ano. A defesa contra erro de cadastro fica a
 * cargo do filtro de sanidade de motor (MAX_PLAUSIBLE_DISPLACEMENT_CC).
 */
const MIN_YEAR_METRIC = 1;

/**
 * Cilindrada máxima plausível (cc) para qualquer veículo do domínio MLB-CARS_AND_VANS.
 * Calibrado em dados reais: maior motor legítimo confirmado é RAM 1500 (5700cc/400hp);
 * produtos com motor 6300-6700cc/360-517hp apareceram em modelos populares (Fiat Strada,
 * Uno) que nunca tiveram essas versões — erro de cadastro isolado no catálogo da ML,
 * não filtrado pelo corte de `metric` por ano (o ano em si tinha metric alto/legítimo).
 */
const MAX_PLAUSIBLE_DISPLACEMENT_CC = 6000;

/**
 * Importa veículos do catálogo real do Mercado Livre (catalog_compatibilities/products_search),
 * um produto de catálogo por combinação marca/modelo/ano/versão, já com atributos ricos
 * (FIPE, motor, dimensões, opcionais).
 *
 * IMPORTANTE — limitações confirmadas do endpoint `products_search/chunks`:
 * - `offset` é IGNORADO pela API: toda chamada devolve sempre os mesmos "top" resultados da
 *   página 1, então paginar uma marca inteira (ou até um modelo popular) não funciona.
 * - Cada chamada tem teto de ~50 resultados, mesmo pedindo `limit` maior.
 * Por isso a única forma de obter o conjunto completo é fatiar por
 * BRAND → MODEL → VEHICLE_YEAR (cascata via `top_values`) e chamar `products_search` só na
 * combinação final marca+modelo+ano, que fica bem abaixo do teto de 50 numa única chamada.
 *
 * A ML também tem erros de cadastro reais no catálogo — ex. confirmado: Fiat Mobi ano "2012"
 * (metric: 2) aponta para um produto de catálogo (MLB25815617) cadastrado com motor 6.0/400cv/
 * sedã, uma contradição absurda para um hatch popular 1.0. Esse tipo de erro é pego pelo filtro
 * de sanidade de motor (MAX_PLAUSIBLE_DISPLACEMENT_CC), não pelo metric do ano — metric baixo
 * também ocorre em carros antigos legítimos (ver MIN_YEAR_METRIC).
 */
@Injectable()
export class VehicleImportService {
  private readonly logger = new Logger(VehicleImportService.name);
  /** make sozinho (sem model) = marca inteira bloqueada. */
  private blockedMakes: Set<string> | null = null;
  /** "make::model" (lowercase) = combinação específica bloqueada, resto da marca intacto. */
  private blockedMakeModels: Set<string> | null = null;
  private blockedMlVehicleIds: Set<string> | null = null;

  constructor(
    private readonly mlCompatibilityAdapter: MercadoLivreCompatibilityAdapter,
    private readonly vehicleCompatibilityService: VehicleCompatibilityService,
    @InjectModel(VehicleImportBlocklistModel.name)
    private readonly blocklistModel: Model<VehicleImportBlocklistModel>,
  ) {}

  /** Carrega a blocklist uma vez por execução (marcas/produtos removidos por curadoria manual). */
  private async loadBlocklist(): Promise<void> {
    const rows = await this.blocklistModel.find().lean().exec();
    this.blockedMakes = new Set(
      rows.filter((r: any) => r.make && !r.model).map((r: any) => r.make.toLowerCase()),
    );
    this.blockedMakeModels = new Set(
      rows
        .filter((r: any) => r.make && r.model)
        .map((r: any) => `${r.make.toLowerCase()}::${r.model.toLowerCase()}`),
    );
    this.blockedMlVehicleIds = new Set(
      rows.map((r: any) => r.mlVehicleId).filter(Boolean),
    );
  }

  private isBlocked(make: string, model?: string, mlVehicleId?: string): boolean {
    if (this.blockedMakes?.has(make.toLowerCase())) return true;
    if (model && this.blockedMakeModels?.has(`${make.toLowerCase()}::${model.toLowerCase()}`)) return true;
    if (mlVehicleId && this.blockedMlVehicleIds?.has(mlVehicleId)) return true;
    return false;
  }

  /**
   * @param skipUntilBrand Se informado, pula marcas até encontrar uma com esse nome (exato,
   * case-insensitive) na ordem de metric da ML, processando essa e todas as seguintes. Útil
   * para retomar uma importação interrompida sem reprocessar marcas já concluídas.
   */
  async importFromMercadoLivre(skipUntilBrand?: string): Promise<VehicleImportResult> {
    const startedAt = Date.now();
    const result: VehicleImportResult = {
      brandsProcessed: 0,
      modelsProcessed: 0,
      yearsSkippedNoMetric: 0,
      productsFound: 0,
      vehiclesUpserted: 0,
      errors: 0,
      durationMs: 0,
    };

    await this.loadBlocklist();

    this.logger.log(
      `Iniciando importação da taxonomia de veículos do Mercado Livre (catálogo)` +
        (skipUntilBrand ? ` a partir de "${skipUntilBrand}"` : ''),
    );

    const allBrands = await this.getTopValues('BRAND', []);
    const startIndex = skipUntilBrand
      ? allBrands.findIndex((b) => b.name.toLowerCase() === skipUntilBrand.toLowerCase())
      : 0;

    if (skipUntilBrand && startIndex === -1) {
      this.logger.warn(`Marca "${skipUntilBrand}" não encontrada; nenhuma marca será processada.`);
      return result;
    }

    const brands = allBrands.slice(Math.max(startIndex, 0));

    for (const brand of brands) {
      try {
        result.vehiclesUpserted += await this.importBrand(brand, result);
      } catch (err: any) {
        this.logger.warn(`Falha ao importar marca=${brand.name}: ${err?.message}`);
        result.errors++;
      }
      result.brandsProcessed++;
    }

    result.durationMs = Date.now() - startedAt;
    this.logger.log(
      `Importação concluída: brands=${result.brandsProcessed} models=${result.modelsProcessed} ` +
        `products=${result.productsFound} upserted=${result.vehiclesUpserted} ` +
        `yearsSkipped=${result.yearsSkippedNoMetric} errors=${result.errors} durationMs=${result.durationMs}`,
    );

    return result;
  }

  /** Importa uma marca inteira (todos os modelos/anos), fatiando por modelo+ano. */
  async importBrand(brand: TopValue, resultAcc?: VehicleImportResult): Promise<number> {
    if (this.blockedMakes === null) await this.loadBlocklist();
    if (this.isBlocked(brand.name)) {
      this.logger.debug(`Marca bloqueada por curadoria: ${brand.name}`);
      return 0;
    }

    let upserted = 0;
    const brandAttr: KnownAttribute = { id: 'BRAND', value_id: brand.id };

    const models = await this.getTopValues('MODEL', [brandAttr]);

    for (const model of models) {
      if (resultAcc) resultAcc.modelsProcessed++;
      const modelAttr: KnownAttribute = { id: 'MODEL', value_id: model.id };

      try {
        upserted += await this.importBrandModel(brand, model, [brandAttr, modelAttr], resultAcc);
      } catch (err: any) {
        this.logger.debug(`Falha ao importar brand=${brand.name} model=${model.name}: ${err?.message}`);
        if (resultAcc) resultAcc.errors++;
      }
    }

    return upserted;
  }

  /** Importa uma combinação marca+modelo isolada — útil para teste/validação em escala menor. */
  async importSingleModel(brand: TopValue, model: TopValue): Promise<number> {
    if (this.blockedMakes === null) await this.loadBlocklist();
    const brandAttr: KnownAttribute = { id: 'BRAND', value_id: brand.id };
    const modelAttr: KnownAttribute = { id: 'MODEL', value_id: model.id };
    return this.importBrandModel(brand, model, [brandAttr, modelAttr]);
  }

  private async importBrandModel(
    brand: TopValue,
    model: TopValue,
    knownSoFar: KnownAttribute[],
    resultAcc?: VehicleImportResult,
  ): Promise<number> {
    let upserted = 0;

    const years = await this.getTopValues('VEHICLE_YEAR', knownSoFar);
    const realYears = years.filter((y) => this.hasRealMetric(y));
    if (resultAcc) resultAcc.yearsSkippedNoMetric += years.length - realYears.length;

    for (const year of realYears) {
      const yearAttr: KnownAttribute = { id: 'VEHICLE_YEAR', value_id: year.id };
      const known = [...knownSoFar, yearAttr];

      const payload = {
        known_attributes: known.map((k) => ({ id: k.id, value_ids: [k.value_id] })),
        site_id: 'MLB',
        domain_id: 'MLB-CARS_AND_VANS',
        limit: 50,
        offset: 0,
      };

      let products: CatalogProduct[] = [];
      try {
        const response = await this.mlCompatibilityAdapter.searchProductCompatibilities(payload, false);
        products = response?.results ?? [];
      } catch (err: any) {
        this.logger.debug(
          `Falha ao buscar produtos brand=${brand.name} model=${model.name} year=${year.name}: ${err?.message}`,
        );
        continue;
      }

      if (resultAcc) resultAcc.productsFound += products.length;

      for (const product of products) {
        try {
          await this.upsertFromCatalogProduct(product);
          upserted++;
        } catch (err: any) {
          this.logger.debug(`Falha ao upsertar produto ${product.id}: ${err?.message}`);
          if (resultAcc) resultAcc.errors++;
        }
      }
    }

    return upserted;
  }

  /** metric abaixo do limiar = combinação "fantasma"/ruído de cadastro na ML — descartar. */
  private hasRealMetric(value: TopValue): boolean {
    return typeof value.metric === 'number' && value.metric >= MIN_YEAR_METRIC;
  }

  private async upsertFromCatalogProduct(product: CatalogProduct): Promise<void> {
    const attrs = new Map<string, CatalogAttribute>();
    for (const a of product.attributes ?? []) attrs.set(a.id, a);

    const get = (id: string): string | undefined => attrs.get(id)?.value_name;

    const make = get('BRAND');
    const model = get('MODEL');
    const version = get('TRIM') ?? model;
    if (!make || !model || !version) return;

    if (this.isBlocked(make, model, product.id)) {
      this.logger.debug(`Produto bloqueado por curadoria: ${product.id} (${make} ${model} ${version})`);
      return;
    }

    const displacementCc = parseDisplacementCc(get('ENGINE_DISPLACEMENT'));
    if (displacementCc !== undefined && displacementCc > MAX_PLAUSIBLE_DISPLACEMENT_CC) {
      this.logger.debug(
        `Descartando produto ${product.id} (${make} ${model} ${version}): displacement implausível ${displacementCc}cc`,
      );
      return;
    }

    const powerHp = parseNumeric(get('POWER'));

    const yearNumber = parseNumeric(get('VEHICLE_YEAR'));
    const years = yearNumber !== undefined ? [yearNumber] : [];

    const features: string[] = [];
    for (const [id, attr] of attrs) {
      if (id.startsWith(HAS_FEATURE_PREFIX) && attr.value_name === 'Sim') {
        features.push(id.slice(HAS_FEATURE_PREFIX.length).toLowerCase());
      }
    }

    await this.vehicleCompatibilityService.upsertByCanonicalKey({
      make,
      model,
      version,
      market: VehicleMarket.BR,
      years,
      origin: VehicleOrigin.ML_IMPORT,
      mlVehicleId: product.id,
      bodyType: this.mapBodyType(get('VEHICLE_BODY_TYPE')),
      transmission: get('TRANSMISSION') ? [get('TRANSMISSION') as string] : undefined,
      engine: {
        displacement: get('ENGINE_DISPLACEMENT') ?? get('ENGINE'),
        fuelType: get('FUEL_TYPE'),
        powerHp,
      },
      fipe: {
        code: get('FIPE_CODE'),
        description: get('FIPE_MODEL'),
        priceUsed: parseNumeric(get('PRICE_USED')),
        priceNew: parseNumeric(get('PRICE_NEW')),
      },
      dimensions: {
        lengthMm: parseNumeric(get('LENGTH')),
        heightMm: parseNumeric(get('HEIGHT')),
        widthMm: parseNumeric(get('WIDTH')),
        wheelbaseMm: parseNumeric(get('DISTANCE_BETWEEN_AXES')),
        fuelCapacityL: parseNumeric(get('FUEL_CAPACITY')),
        doors: parseNumeric(get('DOORS')),
        passengerCapacity: parseNumeric(get('PASSENGER_CAPACITY')),
      },
      features,
    } as any);
  }

  /** Valores reais de VEHICLE_BODY_TYPE no domínio MLB-CARS_AND_VANS (levantado via top_values). */
  private mapBodyType(raw?: string): string | undefined {
    if (!raw) return undefined;
    const map: Record<string, string> = {
      hatch: 'hatch',
      suv: 'suv',
      'sedã': 'sedan',
      'pick-up': 'pickup',
      monovolume: 'minivan',
      'furgão': 'van',
      minivan: 'minivan',
      perua: 'wagon',
      'coupé': 'coupe',
      van: 'van',
      'conversível': 'convertible',
      roadster: 'convertible',
      'off-road': 'suv',
    };
    return map[raw.toLowerCase()] ?? 'other';
  }

  private async getTopValues(attributeId: string, knownAttributes: KnownAttribute[]): Promise<TopValue[]> {
    const response = await this.mlCompatibilityAdapter.getAttributeTopValues(attributeId, knownAttributes);

    if (Array.isArray(response)) return response;
    if (response?.values && Array.isArray(response.values)) return response.values;
    if (response?.data && Array.isArray(response.data)) return response.data;
    return [];
  }
}
