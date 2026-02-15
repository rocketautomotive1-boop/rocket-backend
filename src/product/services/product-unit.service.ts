import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ProductUnitModel, ProductUnitDocument } from '../schemas/product-unit.schema';
import { CreateProductUnitDto } from '../dto/create-product-unit.dto';
import { UpdateProductUnitDto } from '../dto/update-product-unit.dto';

@Injectable()
export class ProductUnitService {
  constructor(
    @InjectModel(ProductUnitModel.name) private productUnitModel: Model<ProductUnitDocument>,
  ) { }

  async findAll(): Promise<ProductUnitModel[]> {
    return this.productUnitModel.find().exec();
  }

  async findOne(id: number | string): Promise<ProductUnitModel> {
    return this.productUnitModel.findById(id).exec();
  }

  async create(createProductUnitDto: CreateProductUnitDto): Promise<ProductUnitModel> {
    const unit = new this.productUnitModel(createProductUnitDto);
    return unit.save();
  }

  async update(id: number | string, updateProductUnitDto: UpdateProductUnitDto): Promise<ProductUnitModel> {
    return this.productUnitModel.findByIdAndUpdate(id, updateProductUnitDto, { new: true }).exec();
  }

  async remove(id: number | string): Promise<void> {
    await this.productUnitModel.findByIdAndDelete(id).exec();
  }
}
