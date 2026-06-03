import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { GENERAL_CONNECTION } from '../../database/connections';
import { GeneralProductModel } from '../schemas/general-product.schema';
import { ProductModel } from '../../product/schemas/product.schema';
import { StockMovementModel } from '../../product/schemas/stock-movement.schema';
import { buildProjectedProductFields } from './build-projected-product';
import { computeStockReconciliation } from './compute-stock-reconciliation';

@Injectable()
export class GeneralProductProjectionService {
  private readonly logger = new Logger(GeneralProductProjectionService.name);

  constructor(
    // general lives on Mongo B (GENERAL_CONNECTION); product/stock on Mongo A (default)
    @InjectModel(GeneralProductModel.name, GENERAL_CONNECTION) private readonly generalModel: Model<GeneralProductModel>,
    @InjectModel(ProductModel.name) private readonly productModel: Model<ProductModel>,
    @InjectModel(StockMovementModel.name) private readonly stockModel: Model<StockMovementModel>,
  ) {}

  /**
   * Projeta o general_product (barcode) num ProductModel system-owned (domain:'general').
   * Idempotente por partNumber='GEN-<barcode>'. Reconcilia estoque via stock_movements.
   * Retorna o id do Product projetado. `mlCategoryId` (de um listing) controla a
   * categoria/readyToPublish; em 3a normalmente undefined.
   */
  async project(barcode: string, mlCategoryId?: string): Promise<{ productId: string }> {
    const general = await this.generalModel.findOne({ barcode }).lean().exec();
    if (!general) throw new NotFoundException(`General product not found: ${barcode}`);

    const fields = buildProjectedProductFields(general, mlCategoryId);

    const product = await this.productModel
      .findOneAndUpdate(
        { partNumber: fields.partNumber },
        {
          $set: {
            name: fields.name,
            barcode: fields.barcode,
            description: fields.description,
            domain: fields.domain,
            active: fields.active,
            price: Types.Decimal128.fromString(String(fields.price)),
            images: fields.images,
            attributes: fields.attributes,
            tax: fields.tax,
            readyToPublish: fields.readyToPublish,
          },
          $setOnInsert: { partNumber: fields.partNumber },
        },
        { upsert: true, new: true },
      )
      .exec();

    const productId = product._id as unknown as Types.ObjectId;

    // Reconcilia o estoque a partir do `quantity` do general (o internal endpoint
    // deriva stockQuantity dos stock_movements, não de um campo do produto).
    const targetQty = Number((general as any).quantity ?? 0);
    const agg = await this.stockModel
      .aggregate([
        { $match: { productId } },
        {
          $group: {
            _id: null,
            total: {
              $sum: {
                $switch: {
                  branches: [
                    { case: { $in: ['$type', ['inbound', 'purchase_return']] }, then: '$quantity' },
                    { case: { $in: ['$type', ['outbound', 'sale', 'transfer']] }, then: { $multiply: ['$quantity', -1] } },
                    { case: { $eq: ['$type', 'adjustment'] }, then: '$quantity' },
                  ],
                  default: 0,
                },
              },
            },
          },
        },
      ])
      .exec();
    const currentQty = agg[0]?.total ?? 0;

    const movement = computeStockReconciliation(targetQty, currentQty);
    if (movement) {
      // productId é tipado como ProductModel no schema; cast como nos demais usos do model.
      await this.stockModel.create({
        productId,
        type: movement.type,
        quantity: movement.quantity,
        date: new Date(),
        reason: 'general-product projection',
        origin: { type: 'warehouse', location: 'general' },
      } as any);
    }

    await this.generalModel.updateOne({ barcode }, { $set: { projectedProductId: productId } }).exec();

    this.logger.log(`Projected general ${barcode} -> product ${productId} (ready=${fields.readyToPublish})`);
    return { productId: String(productId) };
  }
}
