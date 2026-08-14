import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PlateLookupCacheDocument, PlateLookupCacheModel } from '../schemas/plate-lookup-cache.schema';
import { VehicleCompatibilityService } from './vehicle-compatibility.service';
import { PlateProviderClient } from './plate-provider.client';
import { isValidPlate, normalizePlate } from '../../vehicle-shared/utils/plate.util';
import { InvalidPlateFormatException, PlateNotFoundException } from '../../vehicle-shared/exceptions/vehicle.exceptions';

const CACHE_TTL_DAYS = 90;

@Injectable()
export class PlateLookupService {
  private readonly logger = new Logger(PlateLookupService.name);

  constructor(
    @InjectModel(PlateLookupCacheModel.name)
    private readonly cacheModel: Model<PlateLookupCacheDocument>,
    private readonly vehicleCompatibilityService: VehicleCompatibilityService,
    private readonly providerClient: PlateProviderClient,
  ) {}

  async resolveByPlate(rawPlate: string) {
    const plate = normalizePlate(rawPlate);
    if (!isValidPlate(plate)) {
      throw new InvalidPlateFormatException(rawPlate);
    }

    const resolved = await this.lookup(plate);

    const query = [resolved.make, resolved.model, resolved.year, resolved.fuel]
      .filter(Boolean)
      .join(' ');

    return this.vehicleCompatibilityService.resolve({ q: query, limit: 20 });
  }

  private async lookup(plate: string): Promise<{ make: string; model: string; year?: number; fuel?: string }> {
    const cached = await this.cacheModel.findOne({ plate }).lean().exec();
    if (cached) {
      return cached;
    }

    const result = await this.providerClient.fetch(plate);
    if (!result) {
      throw new PlateNotFoundException(plate);
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + CACHE_TTL_DAYS);

    await this.cacheModel.findOneAndUpdate(
      { plate },
      {
        $setOnInsert: {
          plate,
          rawResponse: result.raw,
          make: result.make,
          model: result.model,
          year: result.year,
          fuel: result.fuel,
          engine: result.engine,
          expiresAt,
        },
      },
      { upsert: true },
    ).exec();

    return result;
  }
}
