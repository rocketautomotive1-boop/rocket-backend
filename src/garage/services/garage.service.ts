import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UserGarageVehicleDocument, UserGarageVehicleModel } from '../schemas/user-garage-vehicle.schema';
import { AddGarageVehicleDto } from '../dto/add-garage-vehicle.dto';

@Injectable()
export class GarageService {
  constructor(
    @InjectModel(UserGarageVehicleModel.name)
    private readonly model: Model<UserGarageVehicleDocument>,
  ) {}

  async list(userId: string): Promise<UserGarageVehicleDocument[]> {
    return this.model.find({ userId }).sort({ createdAt: 1 }).exec();
  }

  async add(userId: string, dto: AddGarageVehicleDto): Promise<UserGarageVehicleDocument> {
    const existing = await this.model.findOne({ userId, vehicleId: dto.vehicleId }).exec();
    if (existing) return existing;

    const isFirst = (await this.model.countDocuments({ userId }).exec()) === 0;

    const doc = new this.model({
      userId,
      vehicleId: dto.vehicleId,
      label: dto.label,
      active: isFirst,
    });
    return doc.save();
  }

  async activate(userId: string, id: string): Promise<UserGarageVehicleDocument> {
    const target = await this.model.findOne({ _id: id, userId }).exec();
    if (!target) throw new NotFoundException(`Veículo de garagem ${id} não encontrado`);

    await this.model.updateMany({ userId, active: true }, { $set: { active: false } }).exec();
    target.active = true;
    return target.save();
  }

  async remove(userId: string, id: string): Promise<void> {
    const result = await this.model.deleteOne({ _id: id, userId }).exec();
    if (result.deletedCount === 0) throw new NotFoundException(`Veículo de garagem ${id} não encontrado`);
  }
}
