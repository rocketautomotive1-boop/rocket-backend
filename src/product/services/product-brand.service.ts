import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { BrandModel, BrandDocument } from '../schemas/brand.schema';
import { CreateProductBrandDto } from '../dto/create-product-brand.dto';
import { UpdateProductBrandDto } from '../dto/update-product-brand.dto';

@Injectable()
export class ProductBrandService {

  constructor(
    @InjectModel(BrandModel.name)
    private readonly brandModel: Model<BrandDocument>,
  ) { }

  async findAll(isGenuineOnly?: boolean): Promise<BrandModel[]> {
    const filter: any = { active: true };
    if (isGenuineOnly) {
      filter.isGenuine = true;
    }
    return this.brandModel.find(filter).sort({ name: 1 }).exec();
  }

  async findOne(id: string): Promise<BrandModel> {
    return this.brandModel.findById(id).exec();
  }

  async create(createProductBrandDto: CreateProductBrandDto): Promise<BrandModel> {
    const createdBrand = new this.brandModel(createProductBrandDto);
    return createdBrand.save();
  }

  async update(id: string, updateProductBrandDto: UpdateProductBrandDto): Promise<any> {
    const result = await this.brandModel.updateOne({ _id: id }, { $set: updateProductBrandDto });
    if (result.matchedCount === 0) {
      throw new NotFoundException(`Brand with ID ${id} not found`);
    }
    return { success: true, modifiedCount: result.modifiedCount };
  }

  async remove(id: string): Promise<void> {
    await this.brandModel.updateOne({ _id: id }, { active: false });
  }

  async search(term: string, isGenuineOnly?: boolean): Promise<BrandModel[]> {
    const filter: any = {
      active: true,
      name: { $regex: term, $options: 'i' }
    };
    if (isGenuineOnly) {
      filter.isGenuine = true;
    }
    return this.brandModel.find(filter).limit(20).exec();
  }
}
