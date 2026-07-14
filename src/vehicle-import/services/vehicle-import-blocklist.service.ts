import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { VehicleImportBlocklistModel } from '../schemas/vehicle-import-blocklist.schema';
import { VehicleCompatibilityModel } from '../../vehicle-compatibility/schemas/vehicle-compatibility.schema';

export interface BlockEntryInput {
  mlVehicleId?: string;
  make?: string;
  model?: string;
  reason?: string;
  /**
   * Confirmação explícita exigida para bloquear uma marca INTEIRA (make sem model) — proteção
   * contra bloqueio acidental em massa. Não é necessária quando `model` também é informado
   * (bloqueio restrito à combinação marca+modelo, escopo pequeno por natureza).
   */
  confirmWholeMakeBlock?: boolean;
}

/**
 * Curadoria manual de erros de cadastro da ML: bloquear (por mlVehicleId, make, ou make+model)
 * impede que a próxima importação reintroduza o registro, e remove imediatamente qualquer
 * ocorrência já existente em vehicle_compatibilities.
 */
@Injectable()
export class VehicleImportBlocklistService {
  private readonly logger = new Logger(VehicleImportBlocklistService.name);

  constructor(
    @InjectModel(VehicleImportBlocklistModel.name)
    private readonly blocklistModel: Model<VehicleImportBlocklistModel>,
    @InjectModel(VehicleCompatibilityModel.name)
    private readonly vehicleModel: Model<VehicleCompatibilityModel>,
  ) {}

  async block(entry: BlockEntryInput): Promise<{ blocked: boolean; removed: number }> {
    if (!entry.mlVehicleId && !entry.make) {
      throw new Error('Informe mlVehicleId ou make para bloquear.');
    }

    if (entry.make && !entry.model && !entry.mlVehicleId && !entry.confirmWholeMakeBlock) {
      throw new Error(
        'Bloquear make sem model afeta a marca INTEIRA. Informe model (bloqueio restrito) ou ' +
          'confirmWholeMakeBlock:true (se a intenção é mesmo bloquear a marca toda).',
      );
    }

    await this.blocklistModel.create({
      mlVehicleId: entry.mlVehicleId,
      make: entry.make,
      model: entry.model,
      reason: entry.reason,
    });

    const removeFilter: any = {};
    if (entry.mlVehicleId) removeFilter.mlVehicleId = entry.mlVehicleId;
    if (entry.make) removeFilter.make = entry.make;
    if (entry.model) removeFilter.model = entry.model;

    const result = await this.vehicleModel.deleteMany(removeFilter).exec();
    this.logger.log(
      `Bloqueado ${JSON.stringify(entry)} — ${result.deletedCount} registro(s) removido(s) de vehicle_compatibilities`,
    );

    return { blocked: true, removed: result.deletedCount ?? 0 };
  }

  async list(): Promise<VehicleImportBlocklistModel[]> {
    return this.blocklistModel.find().sort({ createdAt: -1 }).lean().exec();
  }
}
