import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ProductModel, ProductDocument } from '../schemas/product.schema';
import { CreateProductAllocationDto } from '../dto/create-product-allocation.dto';
import { UpdateProductAllocationDto } from '../dto/update-product-allocation.dto';

@Injectable()
export class ProductAllocationService {
  constructor(
    @InjectModel(ProductModel.name) private productModel: Model<ProductDocument>,
  ) { }

  async findAll(): Promise<any[]> {
    return [];
  }

  async findOne(id: number): Promise<any> {
    return null;
  }

  async findByArea(area: string): Promise<any[]> {
    return [];
  }

  async findAvailable(): Promise<any[]> {
    return [];
  }

  async create(createAllocationDto: CreateProductAllocationDto): Promise<any> {
    throw new Error('Method not implemented. Allocations are now embedded in Products.');
  }

  async update(id: number, updateAllocationDto: UpdateProductAllocationDto): Promise<any> {
    throw new Error('Method not implemented. Allocations are now embedded in Products.');
  }

  async remove(id: number): Promise<void> {
    throw new Error('Method not implemented. Allocations are now embedded in Products.');
  }

  async toggleAvailability(id: number): Promise<any> {
    throw new Error('Method not implemented.');
  }

  async toggleActive(id: number): Promise<any> {
    throw new Error('Method not implemented.');
  }

  async findByCoordinates(
    area: string,
    column: string,
    aisle: number,
    rack: string,
    shelf: number,
    bin: number,
    position: number,
  ): Promise<any | null> {
    return null;
  }

  async findByNewCoordinates(
    floor: number,
    room: number,
    row: string,
    shelf: number,
    level: number,
    bin: number,
  ): Promise<any | null> {
    return null;
  }

  parseAllocationQr(qr: string): { floor?: number; room?: number; row?: string; shelf?: number; level?: number; bin?: number } {
    // Formato esperado: "ALLOC;FLOOR=1;ROOM=2;ROW=A;SHELF=1;LEVEL=3;BIN=05"
    const parts = qr.split(';').map(p => p.trim());
    if (!parts[0] || !parts[0].toUpperCase().startsWith('ALLOC')) {
      throw new BadRequestException('QR Code inválido para Allocation');
    }
    const result: any = {};
    for (let i = 1; i < parts.length; i++) {
      const [key, value] = parts[i].split('=');
      if (!key) continue;
      const k = key.toUpperCase();
      const v = (value ?? '').trim();
      switch (k) {
        case 'FLOOR': result.floor = Number(v); break;
        case 'ROOM': result.room = Number(v); break;
        case 'ROW': result.row = v; break;
        case 'SHELF': result.shelf = Number(v); break;
        case 'LEVEL': result.level = Number(v); break;
        case 'BIN': result.bin = Number(v); break;
      }
    }
    return result;
  }

  async findByLocationCode(locationCode: string): Promise<any | null> {
    return null;
  }

  async findByCode(code: string): Promise<any | null> {
    return null;
  }

  async scanAllocation(qr: string, conditionId: number, dryRun?: boolean): Promise<any> {
    throw new Error('Method not implemented (scanAllocation)');
  }
}