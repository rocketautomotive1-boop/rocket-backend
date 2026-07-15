import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  VehicleCompatibilityGroupDocument,
  VehicleCompatibilityGroupModel,
} from '../schemas/vehicle-compatibility-group.schema';
import { CreateVehicleCompatibilityGroupDto } from '../dto/create-vehicle-compatibility-group.dto';
import { UpdateVehicleCompatibilityGroupDto } from '../dto/update-vehicle-compatibility-group.dto';
import { VehicleCompatibilityService } from '../../vehicle-compatibility/services/vehicle-compatibility.service';
import { VehicleCompatibilityGroupNotFoundException } from '../../vehicle-shared/exceptions/vehicle.exceptions';

@Injectable()
export class VehicleCompatibilityGroupService {
  constructor(
    @InjectModel(VehicleCompatibilityGroupModel.name)
    private readonly model: Model<VehicleCompatibilityGroupDocument>,
    private readonly vehicleCompatibilityService: VehicleCompatibilityService,
  ) {}

  async create(dto: CreateVehicleCompatibilityGroupDto): Promise<VehicleCompatibilityGroupDocument> {
    const doc = new this.model(dto);
    return doc.save();
  }

  async list(): Promise<Array<{ id: string; name: string; vehicleCount: number; updatedAt: Date }>> {
    const groups = await this.model.find().sort({ name: 1 }).lean().exec();
    return groups.map((g: any) => ({
      id: String(g._id),
      name: g.name,
      vehicleCount: g.vehicleIds?.length ?? 0,
      updatedAt: g.updatedAt,
    }));
  }

  async findById(id: string): Promise<VehicleCompatibilityGroupDocument> {
    const doc = await this.model.findById(id).exec();
    if (!doc) throw new VehicleCompatibilityGroupNotFoundException(id);
    return doc;
  }

  /** Detalhe populado: nome + veículos completos (via lookup em vehicle_compatibilities). */
  async findByIdPopulated(id: string): Promise<{ id: string; name: string; vehicles: any[] }> {
    const group = await this.findById(id);
    const vehicles = await this.vehicleCompatibilityService.findManyByIds(group.vehicleIds);
    return { id: String(group._id), name: group.name, vehicles };
  }

  /** Só os vehicleIds — usado ao "aplicar grupo" num produto, sem custo de popular. */
  async getVehicleIds(id: string): Promise<string[]> {
    const group = await this.findById(id);
    return group.vehicleIds;
  }

  async update(id: string, dto: UpdateVehicleCompatibilityGroupDto): Promise<VehicleCompatibilityGroupDocument> {
    const doc = await this.model.findByIdAndUpdate(id, { $set: dto }, { new: true }).exec();
    if (!doc) throw new VehicleCompatibilityGroupNotFoundException(id);
    return doc;
  }

  async delete(id: string): Promise<void> {
    const result = await this.model.deleteOne({ _id: id }).exec();
    if (result.deletedCount === 0) throw new VehicleCompatibilityGroupNotFoundException(id);
  }
}
