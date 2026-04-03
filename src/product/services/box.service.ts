import { Injectable, NotFoundException, BadRequestException, NotImplementedException, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BoxModel } from '../schemas/box.schema';
import { AllocationModel, AllocationDocument } from '../schemas/allocation.schema';
import { ProductModel, ProductDocument } from '../schemas/product.schema';
import { CreateBoxDto } from '../dto/create-box.dto';
import { UpdateBoxDto } from '../dto/update-box.dto';

const PRODUCT_SELECT = 'partNumber price costPrice listPrice brands images sku slug';

@Injectable()
export class BoxService implements OnModuleInit {
  constructor(
    @InjectModel(AllocationModel.name) private allocationModel: Model<AllocationDocument>,
    @InjectModel(ProductModel.name) private productModel: Model<ProductDocument>,
  ) { }

  async onModuleInit() {
    try {
      // Tenta remover o índice antigo que está causando conflito com nulls
      await this.allocationModel.collection.dropIndex('boxes.code_1');
      console.log('Índice boxes.code_1 removido com sucesso para recriação sparse.');
    } catch (e) {
      // Ignora se o índice não existir
    }
  }

  async create(createBoxDto: CreateBoxDto) {
    if (!createBoxDto.allocationId) {
      throw new BadRequestException('allocationId is required to create an embedded box');
    }

    const allocation = await this.allocationModel.findById(createBoxDto.allocationId);
    if (!allocation) {
      throw new NotFoundException('Allocation not found');
    }

    const code = createBoxDto.code || await this.generateBoxCode();
    const box = {
      code,
      description: createBoxDto.description,
      itemsCount: 0,
    };

    allocation.boxes.push(box as BoxModel);
    await allocation.save();
    return box;
  }

  async findByCode(code: string, warehouseId?: number | string) {
    const isObjectId = Types.ObjectId.isValid(code);
    const filter: any = isObjectId
      ? { $or: [{ 'boxes.code': code }, { 'boxes._id': new Types.ObjectId(code) }] }
      : { 'boxes.code': code };

    if (warehouseId) filter.warehouseId = warehouseId;

    const allocation = await this.allocationModel.findOne(filter).exec();
    if (!allocation) return null;

    return allocation.boxes.find(b => b.code === code || (isObjectId && String((b as any)._id) === code));
  }

  async findAll(warehouseId?: number | string, search?: string) {
    const filter: any = {};
    if (warehouseId) filter.warehouseId = warehouseId;

    const allocations = await this.allocationModel.find(filter).exec();
    let allBoxes: any[] = [];

    allocations.forEach(a => {
      const boxesWithContext = a.boxes.map(b => ({
        ...b,
        allocationId: a._id,
        warehouseId: a.warehouseId,
      }));
      allBoxes = allBoxes.concat(boxesWithContext);
    });

    if (search) {
      const regex = new RegExp(search, 'i');
      return allBoxes.filter(b => regex.test(b.code) || regex.test(b.description || ''));
    }

    return allBoxes;
  }

  async findOne(id: string | number) {
    const allocations = await this.allocationModel.find({ 'boxes._id': new Types.ObjectId(String(id)) }).exec();
    for (const a of allocations) {
      const box = a.boxes.find(b => String((b as any)._id) === String(id));
      if (box) {
        const boxObj = (box as any).toObject ? (box as any).toObject() : JSON.parse(JSON.stringify(box));
        return { ...boxObj, allocationId: a._id, warehouseId: a.warehouseId };
      }
    }
    throw new NotFoundException('Box não encontrado');
  }

  async update(id: string | number, updateBoxDto: UpdateBoxDto) {
    const filter = { 'boxes._id': new Types.ObjectId(String(id)) };
    const update: any = {};
    if (updateBoxDto.code) update['boxes.$.code'] = updateBoxDto.code;
    if (updateBoxDto.description) update['boxes.$.description'] = updateBoxDto.description;

    const result = await this.allocationModel.findOneAndUpdate(
      filter,
      { $set: update },
      { new: true }
    ).exec();

    if (!result) throw new NotFoundException('Box não encontrado');
    return result.boxes.find(b => String((b as any)._id) === String(id));
  }

  async remove(id: string | number) {
    const result = await this.allocationModel.findOneAndUpdate(
      { 'boxes._id': new Types.ObjectId(String(id)) },
      { $pull: { boxes: { _id: new Types.ObjectId(String(id)) } } },
      { new: true }
    ).exec();

    if (!result) throw new NotFoundException('Box não encontrado');
    return { success: true };
  }

  async getBoxItems(id: string | number) {
    const allocation = await this.allocationModel.findOne({
      'boxes._id': new Types.ObjectId(String(id)),
    }).exec();
    if (!allocation) return { box: null, products: [] };

    const box = allocation.boxes.find(b => String((b as any)._id) === String(id));
    if (!box || !box.products?.length) {
      return { box, products: [] };
    }

    const products = await this.productModel
      .find({ _id: { $in: box.products.map(p => String(p)) } })
      .select(PRODUCT_SELECT)
      .lean()
      .exec();

    return { box, products };
  }

  async getBoxItemsByProductId(productId: string | number) {
    const allocations = await this.allocationModel.find({
      'boxes.products': new Types.ObjectId(String(productId))
    }).exec();

    const results = [];
    for (const a of allocations) {
      const boxes = a.boxes.filter(b =>
        b.products.some(p => String(p) === String(productId))
      );

      for (const b of boxes) {
        const boxObj = (b as any).toObject ? (b as any).toObject() : JSON.parse(JSON.stringify(b));
        results.push({
          box: {
            ...boxObj,
            allocation: {
              id: a._id,
              warehouseId: a.warehouseId,
              locationPath: a.locationPath,
              metadata: a.metadata
            }
          },
          productId: String(productId)
        });
      }
    }
    return results;
  }

  async getBoxItemsByCode(code: string, warehouseId?: number | string) {
    const box = await this.findByCode(code, warehouseId);
    if (!box) throw new NotFoundException('Box não encontrado');

    if (!box.products?.length) {
      return { box, products: [] };
    }

    const products = await this.productModel
      .find({ _id: { $in: box.products.map(p => String(p)) } })
      .select(PRODUCT_SELECT)
      .lean()
      .exec();

    return { box, products };
  }

  // ... (rest of unimplemented methods kept similar or updated slightly)
  getBoxMovements(id: string | number) {
    return [];
  }

  getBoxAllocation(id: string | number) {
    return null;
  }

  getBoxMovementsByCode(code: string, warehouseId?: string | number) {
    throw new NotImplementedException('Method not implemented.');
  }



  async findByCodeForId(code: string, warehouseId?: string | number): Promise<string> {
    throw new NotImplementedException('Method not implemented.');
  }

  async generateBoxCode(warehouseId?: number | string): Promise<string> {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let out = '';
    for (let i = 0; i < 22; i++) {
      out += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return out;
  }

  async createBoxWithCode(warehouseId: number | string, description?: string, allocationId?: number | string): Promise<any> {
    if (!allocationId) throw new BadRequestException('allocationId is required');
    return this.create({
      warehouseId: String(warehouseId),
      description,
      allocationId: String(allocationId)
    });
  }

  async addProductToBox(boxId: string | number, productId: string | number, conditionId: string | number, quantity: number = 1) {
    // Remove product from any existing box first
    await this.allocationModel.updateMany(
      { 'boxes.products': new Types.ObjectId(String(productId)) },
      { $pull: { 'boxes.$[].products': new Types.ObjectId(String(productId)) } }
    ).exec();

    const filter = { 'boxes._id': new Types.ObjectId(String(boxId)) };
    const result = await this.allocationModel.findOneAndUpdate(
      filter,
      { $addToSet: { 'boxes.$.products': new Types.ObjectId(String(productId)) } },
      { new: true }
    ).exec();

    if (!result) throw new NotFoundException('Box não encontrado');
    return result.boxes.find(b => String((b as any)._id) === String(boxId));
  }

  async addProductToBoxByCode(code: string, productId: string | number, conditionId: string | number, quantity: number = 1, warehouseId?: string | number) {
    // Remove product from any existing box first
    await this.allocationModel.updateMany(
      { 'boxes.products': new Types.ObjectId(String(productId)) },
      { $pull: { 'boxes.$[].products': new Types.ObjectId(String(productId)) } }
    ).exec();

    const filter: any = { 'boxes.code': code };
    if (warehouseId) filter.warehouseId = warehouseId;

    const result = await this.allocationModel.findOneAndUpdate(
      filter,
      { $addToSet: { 'boxes.$.products': new Types.ObjectId(String(productId)) } },
      { new: true }
    ).exec();

    if (!result) throw new NotFoundException('Box não encontrado');
    return result.boxes.find(b => b.code === code);
  }

  async createBoxWithAllocation(
    warehouseId: string | number,
    area: string,
    column: string,
    aisle: number,
    rack: string,
    shelf: number,
    bin: number,
    position: number,
    conditionId: string | number,
    description?: string
  ): Promise<any> {
    throw new NotImplementedException('Method not implemented.');
  }

  async createBoxWithAllocationNew(
    warehouseId: string | number,
    floor: number,
    room: number,
    row: string,
    shelf: number,
    level: number,
    bin: number,
    conditionId: string | number,
    description?: string
  ): Promise<any> {
    throw new NotImplementedException('Method not implemented.');
  }

  async linkBoxToAllocation(boxId: string | number, allocationId: string | number): Promise<any> {
    // Find the allocation that currently has this box
    const oldAllocation = await this.allocationModel.findOne({ 'boxes._id': new Types.ObjectId(String(boxId)) }).exec();

    // Find the target allocation
    const newAllocation = await this.allocationModel.findById(allocationId).exec();
    if (!newAllocation) throw new NotFoundException('Nova alocação não encontrada');

    let box: any;
    if (oldAllocation) {
      const idx = oldAllocation.boxes.findIndex(b => String((b as any)._id) === String(boxId));
      if (idx > -1) {
        // If already in the target allocation, just return
        if (String(oldAllocation._id) === String(allocationId)) {
          return oldAllocation.boxes[idx];
        }
        box = oldAllocation.boxes[idx];
        oldAllocation.boxes.splice(idx, 1);
        await oldAllocation.save();
      }
    }

    if (!box) throw new NotFoundException('Box não encontrado em nenhuma alocação para ser movido');

    newAllocation.boxes.push(box);
    await newAllocation.save();
    return box;
  }

  async linkBoxToAllocationByCode(code: string, allocationId: number | string, warehouseId?: number | string): Promise<any> {
    // 1. Find the allocation that CURRENTLY has the box
    const oldAllocation = await this.allocationModel.findOne({ 'boxes.code': code }).exec();

    // 2. Find the target allocation
    const newAllocation = await this.allocationModel.findById(allocationId).exec();
    if (!newAllocation) throw new NotFoundException('Nova alocação não encontrada');

    // 3. If it was in an old allocation, remove it
    let box: any;
    if (oldAllocation) {
      const idx = oldAllocation.boxes.findIndex(b => b.code === code);
      if (idx > -1) {
        box = oldAllocation.boxes[idx];
        oldAllocation.boxes.splice(idx, 1);
        await oldAllocation.save();
      }
    }

    // 4. If not found in any allocation, but we have the code, maybe it's a new "link" 
    // but the system assumes boxes exist inside allocations now. 
    // If it's a completely new box linking, we might need more data, 
    // but let's assume it should exist somewhere.
    if (!box) {
      // Fallback or error
      throw new NotFoundException('Box não encontrado em nenhuma alocação para ser movido');
    }

    // 5. Add to new allocation
    newAllocation.boxes.push(box);
    return newAllocation.save();
  }

  async getBoxAllocationByCode(code: string, warehouseId?: string | number) {
    throw new NotImplementedException('Method not implemented.');
  }

  parseBoxQr(qr: string): { code?: string } {
    throw new NotImplementedException('Method not implemented.');
  }

  async scanBox(
    qr: string,
    warehouseId: string | number,
    allocationId: string | number,
    description?: string
  ): Promise<any> {
    throw new NotImplementedException('Method not implemented.');
  }
}