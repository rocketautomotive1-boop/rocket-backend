import { Injectable, NotImplementedException } from '@nestjs/common';
import { CreateBoxDto } from '../dto/create-box.dto';
import { UpdateBoxDto } from '../dto/update-box.dto';

@Injectable()
export class BoxService {
  constructor() { }

  async create(createBoxDto: CreateBoxDto) {
    throw new NotImplementedException('Method not implemented.');
  }

  findAll(warehouseId?: number, search?: string) {
    throw new NotImplementedException('Method not implemented.');
  }

  findOne(id: number) {
    throw new NotImplementedException('Method not implemented.');
  }

  async update(id: number, updateBoxDto: UpdateBoxDto) {
    throw new NotImplementedException('Method not implemented.');
  }

  async remove(id: number) {
    throw new NotImplementedException('Method not implemented.');
  }

  getBoxItems(id: number) {
    throw new NotImplementedException('Method not implemented.');
  }

  getBoxMovements(id: number) {
    throw new NotImplementedException('Method not implemented.');
  }

  getBoxAllocation(id: number) {
    throw new NotImplementedException('Method not implemented.');
  }

  async findByCode(code: string, warehouseId?: number) {
    throw new NotImplementedException('Method not implemented.');
  }

  getBoxItemsByCode(code: string, warehouseId?: number) {
    throw new NotImplementedException('Method not implemented.');
  }

  getBoxMovementsByCode(code: string, warehouseId?: number) {
    throw new NotImplementedException('Method not implemented.');
  }

  getBoxAllocationsByCode(code: string, warehouseId?: number) {
    throw new NotImplementedException('Method not implemented.');
  }

  async findByCodeForId(code: string, warehouseId?: number): Promise<number> {
    throw new NotImplementedException('Method not implemented.');
  }

  async generateBoxCode(warehouseId?: number): Promise<string> {
    throw new NotImplementedException('Method not implemented.');
  }

  async createBoxWithCode(warehouseId: number, description?: string, allocationId?: number): Promise<any> {
    throw new NotImplementedException('Method not implemented.');
  }

  async addProductToBox(boxId: number, productId: number, conditionId: number, quantity: number = 1) {
    throw new NotImplementedException('Method not implemented.');
  }

  async addProductToBoxByCode(code: string, productId: number, conditionId: number, quantity: number = 1, warehouseId?: number) {
    throw new NotImplementedException('Method not implemented.');
  }

  async createBoxWithAllocation(
    warehouseId: number,
    area: string,
    column: string,
    aisle: number,
    rack: string,
    shelf: number,
    bin: number,
    position: number,
    conditionId: number,
    description?: string
  ): Promise<any> {
    throw new NotImplementedException('Method not implemented.');
  }

  async createBoxWithAllocationNew(
    warehouseId: number,
    floor: number,
    room: number,
    row: string,
    shelf: number,
    level: number,
    bin: number,
    conditionId: number,
    description?: string
  ): Promise<any> {
    throw new NotImplementedException('Method not implemented.');
  }

  async linkBoxToAllocation(boxId: number, allocationId: number): Promise<any> {
    throw new NotImplementedException('Method not implemented.');
  }

  async linkBoxToAllocationByCode(code: string, allocationId: number, warehouseId?: number): Promise<any> {
    throw new NotImplementedException('Method not implemented.');
  }

  async getBoxAllocationByCode(code: string, warehouseId?: number) {
    throw new NotImplementedException('Method not implemented.');
  }

  parseBoxQr(qr: string): { code?: string } {
    throw new NotImplementedException('Method not implemented.');
  }

  async scanBox(
    qr: string,
    warehouseId: number,
    allocationId: number,
    description?: string
  ): Promise<any> {
    throw new NotImplementedException('Method not implemented.');
  }
}