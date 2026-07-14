import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type VehicleImportBlocklistDocument = VehicleImportBlocklistModel & Document;

/**
 * Bloqueia reimportação de produtos/marcas identificados como erro de cadastro na ML durante
 * curadoria manual — sem isso, rodar a varredura completa de novo reintroduz o lixo já limpo
 * (o importador só sabe upsertar o que a API do ML retorna, não sabe o que já foi removido).
 * Ver docs/superpowers/specs/2026-07-09-vehicle-compatibility-unification-design.md.
 */
@Schema({ collection: 'vehicle_import_blocklist', timestamps: true })
export class VehicleImportBlocklistModel {
  /** Bloqueia um produto de catálogo específico da ML (ex: "MLB25815207"). */
  @Prop({ index: true, sparse: true })
  mlVehicleId?: string;

  /**
   * Bloqueia uma marca inteira (ex: "Land", "Larover" — mal-cadastro que duplica outra marca).
   * Se `model` também for informado, o bloqueio é restrito a essa combinação marca+modelo (ex:
   * "Fiat"+"Grasiena" bloqueia só o modelo mal-cadastrado, sem afetar o resto da Fiat).
   */
  @Prop({ index: true, sparse: true })
  make?: string;

  /** Só tem efeito em conjunto com `make` — bloqueia um modelo específico dentro da marca. */
  @Prop({ index: true, sparse: true })
  model?: string;

  @Prop()
  reason?: string;
}

export const VehicleImportBlocklistSchema = SchemaFactory.createForClass(VehicleImportBlocklistModel);
