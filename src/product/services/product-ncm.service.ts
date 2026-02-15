import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ProductNCMModel } from '../schemas/product-ncm.schema';
import { Injectable } from '@nestjs/common';
import { CreateProductNCMDto } from '../dto/create-product-ncm.dto';
import { UpdateProductNCMDto } from '../dto/update-product-ncm.dto';

@Injectable()
export class ProductNCMService {
  constructor(
    @InjectModel(ProductNCMModel.name) private productNCMModel: Model<ProductNCMModel>,
  ) { }

  async findAll(): Promise<any[]> {
    return this.productNCMModel.find().exec();
  }

  async findOne(id: number): Promise<any> {
    return this.productNCMModel.findOne({ id }).exec();
  }

  async create(createProductNCMDto: CreateProductNCMDto): Promise<any> {
    const ncm = new this.productNCMModel(createProductNCMDto);
    return ncm.save();
  }

  async update(id: number, updateProductNCMDto: UpdateProductNCMDto): Promise<any> {
    return this.productNCMModel.findOneAndUpdate({ id }, updateProductNCMDto, { new: true }).exec();
  }

  async remove(id: number): Promise<void> {
    await this.productNCMModel.findOneAndDelete({ id }).exec();
  }
}
