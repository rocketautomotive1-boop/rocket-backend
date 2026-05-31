// backend/src/general-product/general-product.repository.ts
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { GENERAL_CONNECTION } from '../database/connections';
import { GeneralProductModel, GeneralProductDocument } from './schemas/general-product.schema';

/**
 * Persistência do domínio GeneralProduct na conexão `general` (Mongo B).
 * Sanitiza Decimal128/ObjectId no boundary (espelha ProductRepository.toDto).
 */
@Injectable()
export class GeneralProductRepository {
  constructor(
    @InjectModel(GeneralProductModel.name, GENERAL_CONNECTION)
    private readonly model: Model<GeneralProductDocument>,
  ) {}

  async create(data: Partial<GeneralProductModel>): Promise<GeneralProductModel> {
    const doc = await this.model.create(data);
    return this.toDto(doc);
  }

  async findByBarcode(barcode: string): Promise<GeneralProductModel | null> {
    const doc = await this.model.findOne({ barcode }).lean().exec();
    return this.toDto(doc);
  }

  private toDto(doc: any): GeneralProductModel | null {
    if (!doc) return null;
    const obj = typeof doc.toObject === 'function' ? doc.toObject() : doc;
    return this.sanitize(obj);
  }

  private sanitize(value: any): any {
    if (Array.isArray(value)) return value.map((v) => this.sanitize(v));
    if (value instanceof Types.ObjectId) return value.toString();
    if (value instanceof Types.Decimal128 || value?._bsontype === 'Decimal128') return value.toString();
    if (value?.$numberDecimal) return value.$numberDecimal;
    if (value && typeof value === 'object') {
      const out: any = {};
      for (const k of Object.keys(value)) out[k] = k === '_id' ? value[k]?.toString() : this.sanitize(value[k]);
      return out;
    }
    return value;
  }
}
