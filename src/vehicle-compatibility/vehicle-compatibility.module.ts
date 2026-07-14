import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HttpModule } from '@nestjs/axios';
import { VehicleCompatibilityModel, VehicleCompatibilitySchema } from './schemas/vehicle-compatibility.schema';
import { PlateLookupCacheModel, PlateLookupCacheSchema } from './schemas/plate-lookup-cache.schema';
import { VehicleCompatibilityService } from './services/vehicle-compatibility.service';
import { PlateLookupService } from './services/plate-lookup.service';
import { PlateProviderClient } from './services/plate-provider.client';
import { VehicleCompatibilityController } from './controllers/vehicle-compatibility.controller';

@Module({
  imports: [
    HttpModule,
    MongooseModule.forFeature([
      { name: VehicleCompatibilityModel.name, schema: VehicleCompatibilitySchema },
      { name: PlateLookupCacheModel.name, schema: PlateLookupCacheSchema },
    ]),
  ],
  controllers: [VehicleCompatibilityController],
  providers: [VehicleCompatibilityService, PlateLookupService, PlateProviderClient],
  exports: [VehicleCompatibilityService],
})
export class VehicleCompatibilityModule {}
