import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { VehicleAiPromptBuilder } from './ai/vehicle-ai-prompt.builder';
import { VehicleAiService } from './ai/vehicle-ai.service';
import { VehicleApprovalPolicy } from './policies/vehicle-approval.policy';
import { VehicleCanonicalMapper } from './mappers/vehicle-canonical.mapper';
import { VehicleMetricsService } from './metrics/vehicle-metrics.service';
import { VehicleAiCacheModel, VehicleAiCacheSchema } from './ai/vehicle-ai-cache.schema';
import { VehicleAiCacheService } from './ai/vehicle-ai-cache.service';

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: VehicleAiCacheModel.name, schema: VehicleAiCacheSchema },
    ]),
  ],
  providers: [
    VehicleAiPromptBuilder,
    VehicleAiService,
    VehicleApprovalPolicy,
    VehicleCanonicalMapper,
    VehicleMetricsService,
    VehicleAiCacheService,
  ],
  exports: [
    VehicleAiPromptBuilder,
    VehicleAiService,
    VehicleApprovalPolicy,
    VehicleCanonicalMapper,
    VehicleMetricsService,
    VehicleAiCacheService,
  ],
})
export class VehicleSharedModule {}
