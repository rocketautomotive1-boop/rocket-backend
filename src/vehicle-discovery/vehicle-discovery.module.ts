import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { VehicleDiscoveryModel, VehicleDiscoverySchema } from './schemas/vehicle-discovery.schema';
import { VehicleDiscoveryService } from './services/vehicle-discovery.service';
import { VehicleDiscoveryProcessorService } from './services/vehicle-discovery-processor.service';
import { VehicleDiscoveryWorker } from './workers/vehicle-discovery.worker';
import { VehicleDiscoveryController } from './controllers/vehicle-discovery.controller';
import { VehicleCompatibilityModule } from '../vehicle-compatibility/vehicle-compatibility.module';
import { VehicleSharedModule } from '../vehicle-shared/vehicle-shared.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: VehicleDiscoveryModel.name, schema: VehicleDiscoverySchema },
    ]),
    VehicleSharedModule,
    VehicleCompatibilityModule,
  ],
  controllers: [VehicleDiscoveryController],
  providers: [
    VehicleDiscoveryService,
    VehicleDiscoveryProcessorService,
    VehicleDiscoveryWorker,
  ],
  exports: [VehicleDiscoveryService],
})
export class VehicleDiscoveryModule {}
