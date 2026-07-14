import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { UserGarageVehicleModel, UserGarageVehicleSchema } from './schemas/user-garage-vehicle.schema';
import { GarageService } from './services/garage.service';
import { GarageController } from './controllers/garage.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: UserGarageVehicleModel.name, schema: UserGarageVehicleSchema },
    ]),
    AuthModule,
  ],
  controllers: [GarageController],
  providers: [GarageService],
  exports: [GarageService],
})
export class GarageModule {}
