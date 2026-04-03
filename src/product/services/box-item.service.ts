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

  async addItemToBoxByCode(code: string, addBoxItemDto: AddBoxItemDto, warehouseId?: string | number) {
    throw new NotImplementedException('Method not implemented.');
  }

  async addMultipleItemsToBoxByCode(code: string, items: AddBoxItemDto[], warehouseId?: string | number) {
    throw new NotImplementedException('Method not implemented.');
  }

  async getBoxItemsSummaryByCode(code: string, warehouseId?: string | number) {
    throw new NotImplementedException('Method not implemented.');
  }

  findAll(boxId?: string | number) {
    throw new NotImplementedException('Method not implemented.');
  }

  findOne(id: string | number) {
    throw new NotImplementedException('Method not implemented.');
  }

  async update(id: string | number, updateBoxItemDto: UpdateBoxItemDto) {
    throw new NotImplementedException('Method not implemented.');
  }

  async remove(id: string | number) {
    throw new NotImplementedException('Method not implemented.');
  }

  async addMultipleItems(boxId: string | number, items: CreateBoxItemDto[]) {
    throw new NotImplementedException('Method not implemented.');
  }

  async getBoxItemsByProduct(productId: string | number) {
    throw new NotImplementedException('Method not implemented.');
  }

  async getBoxItemsByCondition(conditionId: string | number) {
    throw new NotImplementedException('Method not implemented.');
  }

  async getBoxItemsSummary(boxId: string | number) {
    throw new NotImplementedException('Method not implemented.');
  }
}