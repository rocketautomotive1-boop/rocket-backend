import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { VehicleCompatibilityModel, VehicleCompatibilitySchema } from './schemas/vehicle-compatibility.schema';
import { VehicleCompatibilityService } from './services/vehicle-compatibility.service';
import { VehicleCompatibilityController } from './controllers/vehicle-compatibility.controller';
import { VehicleSharedModule } from '../vehicle-shared/vehicle-shared.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: VehicleCompatibilityModel.name, schema: VehicleCompatibilitySchema },
    ]),
    VehicleSharedModule,
  ],
  controllers: [VehicleCompatibilityController],
  providers: [VehicleCompatibilityService],
  exports: [VehicleCompatibilityService],
})
export class VehicleCompatibilityModule {}
