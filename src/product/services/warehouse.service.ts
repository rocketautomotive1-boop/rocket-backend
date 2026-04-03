import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { WarehouseModel, WarehouseDocument } from '../schemas/warehouse.schema';
import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateWarehouseDto } from '../dto/create-warehouse.dto';
import { UpdateWarehouseDto } from '../dto/update-warehouse.dto';

@Injectable()
export class WarehouseService {
  constructor(
    @InjectModel(WarehouseModel.name) private warehouseModel: Model<WarehouseDocument>,
  ) { }

  create(createWarehouseDto: CreateWarehouseDto) {
    throw new Error('Method not implemented. Warehouse entity removed from Postgres.');
  }

  async findAll(search?: string) {
    const warehouses = await this.warehouseModel.find().exec();
    return warehouses.map(w => ({
      id: w._id.toString(),
      name: w.name,
      address: w.address,
    }));
  }

  async findOne(id: number | string) {
    const w = await this.warehouseModel.findById(id).exec();
    if (!w) return null;
    return { id: w._id.toString(), name: w.name, address: w.address };
  }

  async update(id: number, updateWarehouseDto: UpdateWarehouseDto) {
    throw new Error('Method not implemented. Warehouse entity removed from Postgres.');
  }

  async remove(id: number) {
    throw new Error('Method not implemented. Warehouse entity removed from Postgres.');
  }

  getWarehouseBoxes(id: number) {
    return null;
  }

  getWarehouseMovements(id: number) {
    return null;
  }

  getWarehouseAllocations(id: number) {
    return null;
  }
}