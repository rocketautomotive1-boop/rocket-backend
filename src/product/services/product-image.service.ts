import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ProductModel, ProductDocument, ProductImage } from '../schemas/product.schema';

@Injectable()
export class ProductImageService {
  constructor(
    @InjectModel(ProductModel.name) private productModel: Model<ProductDocument>,
  ) { }

  async findByProductId(productId: number | string): Promise<ProductImage[]> {
    const product = await this.productModel.findById(productId).select('images');
    return product ? product.images || [] : [];
  }

  async findOne(id: number | string): Promise<any> {
    // Cannot easily find single embedded image by ID unless we manually search
    // Assuming 'id' matches something or we use logic
    // But images in schema don't explicit have _id unless added.
    // ProductImage schema line 9: @Schema() export class ProductImage { @Prop() url: string; ... }
    // It doesn't have explicit _id. Mongoose adds _id by default to subdocs in array.

    // We'll search in all products? Expensive.
    // Usually we always have productId context.
    // If not, this method is hard to implement efficiently.
    // Assuming productId is known or we scan.

    // For now, let's implement only if strictly needed.
    // But compilation needs it.

    const product = await this.productModel.findOne({ 'images._id': id }, { 'images.$': 1 });
    return product ? product.images[0] : null;
  }

  async create(productId: number | string, imageData: Partial<ProductImage>): Promise<any> {
    const product = await this.productModel.findById(productId);
    if (!product) {
      throw new NotFoundException(`Produto com ID ${productId} não encontrado`);
    }

    const newImage: any = { ...imageData, _id: new Types.ObjectId() }; // Ensure _id
    if (!product.images) product.images = [];
    product.images.push(newImage);
    await product.save();
    return newImage;
  }

  async update(id: number | string, imageData: Partial<ProductImage>): Promise<any> {
    const product = await this.productModel.findOne({ 'images._id': id });
    if (!product) throw new NotFoundException('Image not found');

    const idx = product.images.findIndex((img: any) => img._id == id);
    if (idx !== -1) {
      Object.assign(product.images[idx], imageData);
      await product.save();
      return product.images[idx];
    }
    return null;
  }

  async remove(id: number | string): Promise<boolean> {
    const product = await this.productModel.findOne({ 'images._id': id });
    if (!product) return false;

    product.images = product.images.filter((img: any) => img._id != id);
    await product.save();
    return true;
  }

  async removeAllByProductId(productId: number | string): Promise<boolean> {
    const product = await this.productModel.findById(productId);
    if (!product) return false;
    product.images = [];
    await product.save();
    return true;
  }

  async updateImages(productId: number, images: { url: string; key: string; filename?: string; mimeType?: string }[]): Promise<ProductImage[]> {
    // Primeiro, remover todas as imagens existentes
    await this.removeAllByProductId(productId);

    // Depois, criar as novas imagens
    const product = await this.productModel.findById(productId);
    if (!product) throw new NotFoundException('Product not found');

    const newImages = images.map((img, index) => ({
      ...img,
      _id: new Types.ObjectId(),
      order: index,
      status: 'active',
      originalName: img.filename, // Mapping filename to originalName as per schema
      main: index === 0 // Assume first is main
    }));

    product.images = newImages as any;
    await product.save();

    return newImages as any;
  }
}

