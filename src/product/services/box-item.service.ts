import { Injectable, NotImplementedException } from '@nestjs/common';
import { CreateBoxItemDto } from '../dto/create-box-item.dto';
import { UpdateBoxItemDto } from '../dto/update-box-item.dto';
import { AddBoxItemDto } from '../dto/add-box-item.dto';

@Injectable()
export class BoxItemService {
  constructor() { }

  async create(createBoxItemDto: CreateBoxItemDto) {
    throw new NotImplementedException('Method not implemented.');
  }

  async addItemToBoxByCode(code: string, addBoxItemDto: AddBoxItemDto, warehouseId?: number) {
    throw new NotImplementedException('Method not implemented.');
  }

  async addMultipleItemsToBoxByCode(code: string, items: AddBoxItemDto[], warehouseId?: number) {
    throw new NotImplementedException('Method not implemented.');
  }

  async getBoxItemsSummaryByCode(code: string, warehouseId?: number) {
    throw new NotImplementedException('Method not implemented.');
  }

  findAll(boxId?: number) {
    throw new NotImplementedException('Method not implemented.');
  }

  findOne(id: number) {
    throw new NotImplementedException('Method not implemented.');
  }

  async update(id: number, updateBoxItemDto: UpdateBoxItemDto) {
    throw new NotImplementedException('Method not implemented.');
  }

  async remove(id: number) {
    throw new NotImplementedException('Method not implemented.');
  }

  async addMultipleItems(boxId: number, items: CreateBoxItemDto[]) {
    throw new NotImplementedException('Method not implemented.');
  }

  async getBoxItemsByProduct(productId: number) {
    throw new NotImplementedException('Method not implemented.');
  }

  async getBoxItemsByCondition(conditionId: number) {
    throw new NotImplementedException('Method not implemented.');
  }

  async getBoxItemsSummary(boxId: number) {
    throw new NotImplementedException('Method not implemented.');
  }
}