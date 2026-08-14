import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  VehicleCompatibilityGroupModel,
  VehicleCompatibilityGroupSchema,
} from './schemas/vehicle-compatibility-group.schema';
import { VehicleCompatibilityGroupService } from './services/vehicle-compatibility-group.service';
import { VehicleCompatibilityGroupController } from './controllers/vehicle-compatibility-group.controller';
import { VehicleCompatibilityModule } from '../vehicle-compatibility/vehicle-compatibility.module';

@Module({
  imports: [
    VehicleCompatibilityModule,
    MongooseModule.forFeature([
      { name: VehicleCompatibilityGroupModel.name, schema: VehicleCompatibilityGroupSchema },
    ]),
  ],
  controllers: [VehicleCompatibilityGroupController],
  providers: [VehicleCompatibilityGroupService],
})
export class VehicleCompatibilityGroupModule {}
