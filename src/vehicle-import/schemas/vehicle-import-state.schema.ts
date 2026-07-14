import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type VehicleImportStateDocument = VehicleImportStateModel & Document;

/** Documento singleton (_id fixo) com o estado da última importação — usado como gate do scheduler. */
@Schema({ collection: 'vehicle_import_state' })
export class VehicleImportStateModel {
  @Prop({ default: 'singleton' })
  _id: string;

  /** products_last_updated do domínio MLB-CARS_AND_VANS na última execução processada. */
  @Prop()
  lastProductsUpdatedAt?: string;

  @Prop()
  lastRunAt?: Date;
}

export const VehicleImportStateSchema = SchemaFactory.createForClass(VehicleImportStateModel);
