import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { VEHICLE_CONSTANTS } from '../constants/vehicle.constants';
import { VehicleAiOutput } from '../types/vehicle.types';
import { VehicleAiCacheDocument, VehicleAiCacheModel } from './vehicle-ai-cache.schema';

@Injectable()
export class VehicleAiCacheService {
  private readonly logger = new Logger(VehicleAiCacheService.name);

  constructor(
    @InjectModel(VehicleAiCacheModel.name)
    private readonly cacheModel: Model<VehicleAiCacheDocument>,
  ) {}

  async get(cacheKey: string): Promise<{
    output: VehicleAiOutput;
    rawResponse: string;
    model: string;
  } | null> {
    const entry = await this.cacheModel
      .findOne({
        cacheKey,
        aiPromptVersion: VEHICLE_CONSTANTS.AI_PROMPT_VERSION,
        expiresAt: { $gt: new Date() },
      })
      .lean()
      .exec();

    if (!entry) return null;

    this.logger.debug(`AI cache hit: ${cacheKey}`);
    return {
      output: entry.aiOutput as VehicleAiOutput,
      rawResponse: entry.rawResponse ?? '',
      model: entry.aiModel,
    };
  }

  async set(
    cacheKey: string,
    output: VehicleAiOutput,
    rawResponse: string,
    model: string,
  ): Promise<void> {
    const expiresAt = new Date(Date.now() + VEHICLE_CONSTANTS.AI_CACHE_TTL_MS);
    await this.cacheModel
      .findOneAndUpdate(
        { cacheKey },
        {
          $set: {
            cacheKey,
            aiPromptVersion: VEHICLE_CONSTANTS.AI_PROMPT_VERSION,
            aiOutput: output,
            rawResponse,
            aiModel: model,
            expiresAt,
          },
        },
        { upsert: true, new: true },
      )
      .exec();
  }
}
