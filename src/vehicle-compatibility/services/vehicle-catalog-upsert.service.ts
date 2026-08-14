import { Injectable, Logger } from '@nestjs/common';
import { VehicleCompatibilityService } from './vehicle-compatibility.service';
import { VehicleCompatibilityDocument } from '../schemas/vehicle-compatibility.schema';
import { VehicleBodyType, VehicleMarket, VehicleOrigin } from '../../vehicle-shared/types/vehicle.types';

interface CatalogAttribute {
  id: string;
  value_id?: string;
  value_name?: string;
}

interface CatalogProduct {
  id: string;
  attributes: CatalogAttribute[];
}

const HAS_FEATURE_PREFIX = 'HAS_';

/**
 * Cilindrada máxima plausível (cc) para qualquer veículo do domínio MLB-CARS_AND_VANS.
 * Mesmo limiar calibrado do antigo módulo vehicle-import (removido em 8821c80, base
 * estável — não por bug): erros de cadastro no catálogo ML produzem motores absurdos
 * (6000cc+) em modelos populares que nunca tiveram essa versão.
 */
const MAX_PLAUSIBLE_DISPLACEMENT_CC = 6000;

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
 * ou um número puro tipo "6.3" (litros, sem unidade). Normaliza sempre para cc.
 */
function parseDisplacementCc(raw?: string): number | undefined {
  if (!raw) return undefined;
  const value = parseNumeric(raw);
  if (value === undefined) return undefined;
  return /cc/i.test(raw) ? value : value * 1000;
}

/** Valores reais de VEHICLE_BODY_TYPE no domínio MLB-CARS_AND_VANS (herdado do vehicle-import). */
function mapBodyType(raw?: string): VehicleBodyType | undefined {
  if (!raw) return undefined;
  const map: Record<string, VehicleBodyType> = {
    hatch: VehicleBodyType.HATCH,
    suv: VehicleBodyType.SUV,
    'sedã': VehicleBodyType.SEDAN,
    'pick-up': VehicleBodyType.PICKUP,
    monovolume: VehicleBodyType.MINIVAN,
    'furgão': VehicleBodyType.VAN,
    minivan: VehicleBodyType.MINIVAN,
    perua: VehicleBodyType.WAGON,
    'coupé': VehicleBodyType.COUPE,
    van: VehicleBodyType.VAN,
    'conversível': VehicleBodyType.CONVERTIBLE,
    roadster: VehicleBodyType.CONVERTIBLE,
    'off-road': VehicleBodyType.SUV,
  };
  return map[raw.toLowerCase()] ?? VehicleBodyType.OTHER;
}

export interface VehicleCatalogUpsertResult {
  upserted: VehicleCompatibilityDocument[];
  skipped: number;
}

/**
 * Resolve/cria vehicle_compatibilities a partir de resultados de
 * catalog_compatibilities/products_search/chunks (peça→veículos). Reaproveita
 * VehicleCompatibilityService.upsertByCanonicalKey (proteção "manual sempre vence" já
 * embutida) e a lógica de parsing de atributos ML do antigo módulo vehicle-import
 * (removido em 8821c80 — base estável, não por bug; recuperado via git history).
 * Ver docs/superpowers/specs/2026-07-15-product-catalog-import-design.md.
 */
@Injectable()
export class VehicleCatalogUpsertService {
  private readonly logger = new Logger(VehicleCatalogUpsertService.name);

  constructor(private readonly vehicleCompatibilityService: VehicleCompatibilityService) {}

  async upsertFromCatalogProducts(products: CatalogProduct[]): Promise<VehicleCatalogUpsertResult> {
    const upserted: VehicleCompatibilityDocument[] = [];
    let skipped = 0;

    for (const product of products) {
      const doc = await this.upsertFromCatalogProduct(product);
      if (doc) {
        upserted.push(doc);
      } else {
        skipped++;
      }
    }

    return { upserted, skipped };
  }

  private async upsertFromCatalogProduct(product: CatalogProduct): Promise<VehicleCompatibilityDocument | null> {
    const attrs = new Map<string, CatalogAttribute>();
    for (const a of product.attributes ?? []) attrs.set(a.id, a);

    const get = (id: string): string | undefined => attrs.get(id)?.value_name;

    const make = get('BRAND');
    const model = get('MODEL');
    const version = get('TRIM') ?? model;
    if (!make || !model || !version) {
      this.logger.debug(`Produto ${product.id}: sem BRAND/MODEL/TRIM suficiente — descartado`);
      return null;
    }

    const displacementCc = parseDisplacementCc(get('ENGINE_DISPLACEMENT'));
    if (displacementCc !== undefined && displacementCc > MAX_PLAUSIBLE_DISPLACEMENT_CC) {
      this.logger.debug(
        `Descartando produto ${product.id} (${make} ${model} ${version}): displacement implausível ${displacementCc}cc`,
      );
      return null;
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

    try {
      return await this.vehicleCompatibilityService.upsertByCanonicalKey({
        make,
        model,
        version,
        market: VehicleMarket.BR,
        years,
        origin: VehicleOrigin.ML_IMPORT,
        mlVehicleId: product.id,
        bodyType: mapBodyType(get('VEHICLE_BODY_TYPE')),
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
    } catch (err: any) {
      this.logger.warn(`Falha ao upsertar veículo do produto ${product.id}: ${err?.message}`);
      return null;
    }
  }
}
