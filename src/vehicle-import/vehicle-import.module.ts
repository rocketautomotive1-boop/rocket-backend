import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MarketplaceModule } from '../marketplace/marketplace.module';
import { VehicleCompatibilityModule } from '../vehicle-compatibility/vehicle-compatibility.module';
import { VehicleCompatibilityModel, VehicleCompatibilitySchema } from '../vehicle-compatibility/schemas/vehicle-compatibility.schema';
import { VehicleImportService } from './services/vehicle-import.service';
import { VehicleImportBlocklistService } from './services/vehicle-import-blocklist.service';
import { VehicleImportController } from './controllers/vehicle-import.controller';
import { VehicleImportScheduler } from './vehicle-import.scheduler';
import { VehicleImportBlocklistModel, VehicleImportBlocklistSchema } from './schemas/vehicle-import-blocklist.schema';
import { VehicleImportStateModel, VehicleImportStateSchema } from './schemas/vehicle-import-state.schema';

@Module({
  imports: [
    MarketplaceModule,
    VehicleCompatibilityModule,
    MongooseModule.forFeature([
      { name: VehicleImportBlocklistModel.name, schema: VehicleImportBlocklistSchema },
      { name: VehicleCompatibilityModel.name, schema: VehicleCompatibilitySchema },
      { name: VehicleImportStateModel.name, schema: VehicleImportStateSchema },
    ]),
  ],
  controllers: [VehicleImportController],
  providers: [VehicleImportService, VehicleImportBlocklistService, VehicleImportScheduler],
})
export class VehicleImportModule {}
