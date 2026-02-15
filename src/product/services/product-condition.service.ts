import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ProductConditionModel } from '../schemas/product-condition.schema';
import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateProductConditionDto } from '../dto/create-product-condition.dto';
import { UpdateProductConditionDto } from '../dto/update-product-condition.dto';

@Injectable()
export class ProductConditionService {
  constructor(
    @InjectModel(ProductConditionModel.name) private productConditionModel: Model<ProductConditionModel>,
  ) { }

  async create(createProductConditionDto: CreateProductConditionDto) {
    const createdCondition = new this.productConditionModel(createProductConditionDto);
    return createdCondition.save();
  }

  async findAll(search?: string) {
    if (search) {
      return this.productConditionModel.find({
        name: { $regex: search, $options: 'i' }
      }).sort({ name: 1 }).exec();
    }
    return this.productConditionModel.find().sort({ name: 1 }).exec();
  }

  async findOne(id: number) {
    // Assuming 'id' is still used as a number or we need to find by _id if migrated to ObjectId.
    // Use flexible query if unsure, or stick to 'id' if using autoincrement plugin (unlikely).
    // Given the previous code used number id, I'll assume usage of 'id' field in schema or fallback.
    // Checking schema later, but for now assuming 'id' field match.
    // If schema is standard mongo, findOne({ id }) or findById(id) if ObjectId.
    // Given previous TypeORM used number, likely 'id' field exists or we should query by it.
    return this.productConditionModel.findOne({ id }).exec();
  }

  async update(id: number, updateProductConditionDto: UpdateProductConditionDto) {
    const updated = await this.productConditionModel.findOneAndUpdate(
      { id },
      updateProductConditionDto,
      { new: true }
    ).exec();

    if (!updated) {
      throw new NotFoundException(`Product condition with ID ${id} not found`);
    }
    return updated;
  }

  async remove(id: number) {
    const deleted = await this.productConditionModel.findOneAndDelete({ id }).exec();
    if (!deleted) {
      throw new NotFoundException(`Product condition with ID ${id} not found`);
    }
    return deleted;
  }

  async findByName(name: string) {
    return this.productConditionModel.findOne({ name }).exec();
  }
} 