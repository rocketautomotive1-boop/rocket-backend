import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ProductWarrantyModel } from '../schemas/product-warranty.schema';
import { Injectable } from '@nestjs/common';
import { CreateProductWarrantyDto } from '../dto/create-product-warranty.dto';
import { UpdateProductWarrantyDto } from '../dto/update-product-warranty.dto';

@Injectable()
export class ProductWarrantyService {
  constructor(
    @InjectModel(ProductWarrantyModel.name) private productWarrantyModel: Model<ProductWarrantyModel>,
  ) { }

  async findAll(): Promise<any[]> {
    return this.productWarrantyModel.find().exec();
  }

  async findOne(id: number): Promise<any> {
    return this.productWarrantyModel.findOne({ id }).exec();
  }

  async create(createProductWarrantyDto: CreateProductWarrantyDto): Promise<any> {
    const warranty = new this.productWarrantyModel(createProductWarrantyDto);
    return warranty.save();
  }

  async update(id: number, updateProductWarrantyDto: UpdateProductWarrantyDto): Promise<any> {
    return this.productWarrantyModel.findOneAndUpdate({ id }, updateProductWarrantyDto, { new: true }).exec();
  }

  async remove(id: number): Promise<void> {
    await this.productWarrantyModel.findOneAndDelete({ id }).exec();
  }
}