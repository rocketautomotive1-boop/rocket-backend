import { Injectable, NotFoundException, OnModuleInit, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { BrandModel, BrandDocument } from '../schemas/brand.schema';
import { ProductModel, ProductDocument } from '../schemas/product.schema';
import { CreateProductBrandDto } from '../dto/create-product-brand.dto';
import { UpdateProductBrandDto } from '../dto/update-product-brand.dto';

@Injectable()
export class ProductBrandService implements OnModuleInit {
  private readonly logger = new Logger(ProductBrandService.name);

  constructor(
    @InjectModel(BrandModel.name)
    private readonly brandModel: Model<BrandDocument>,
    @InjectModel(ProductModel.name)
    private readonly productModel: Model<ProductDocument>,
  ) { }

  onModuleInit() {
    this.watchBrands();
  }

  private watchBrands() {
    const changeStream = this.brandModel.watch();
    changeStream.on('change', async (change) => {
      try {
        if (change.operationType === 'update' || change.operationType === 'replace') {
          const documentKey = (change as any).documentKey;
          const updatedFields = (change as any).updateDescription?.updatedFields || {};
          const brandId = documentKey._id;

          // Check if relevant fields changed
          const relevantFields = ['name', 'logoUrl', 'isGenuine', 'shortName', 'fullName', 'amazonName', 'active'];
          const shouldSync = Object.keys(updatedFields).some(field => relevantFields.includes(field));

          if (shouldSync) {
            this.logger.log(`Brand ${brandId} updated. Syncing products...`);
            const fullBrand = await this.brandModel.findById(brandId).lean();
            if (fullBrand) {
              await this.productModel.updateMany(
                { 'brand._id': brandId },
                {
                  $set: {
                    'brand.name': fullBrand.name,
                    'brand.logoUrl': fullBrand.logoUrl,
                    'brand.isGenuine': fullBrand.isGenuine,
                    'brand.shortName': fullBrand.shortName,
                    'brand.fullName': fullBrand.fullName,
                    'brand.amazonName': fullBrand.amazonName,
                    // If brand becomes inactive, maybe products should too, but that's a business rule.
                    // For now, only syncing brand data.
                  }
                }
              );
            }
          }
        }
      } catch (error) {
        this.logger.error('Error syncing brand changes', error);
      }
    });
  }

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
