import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ProductDraftModel, ProductDraftDocument } from '../product/product-types';

type DraftStatus = 'pending' | 'processing' | 'done' | 'error';

@Injectable()
export class ProductDraftsService {
  constructor(
    @InjectModel(ProductDraftModel.name)
    private readonly draftModel: Model<ProductDraftDocument>,
  ) { }

  async findAll(params?: { status?: DraftStatus; batchId?: string; limit?: number; offset?: number }): Promise<any[]> {
    const filter: any = {};
    if (params?.status) filter.status = params.status;
    if (params?.batchId) filter.batchId = params.batchId;

    const query = this.draftModel.find(filter).sort({ createdAt: -1 });
    if (params?.limit) query.limit(params.limit);
    if (params?.offset) query.skip(params.offset);

    const rows = await query.exec();
    return rows.map(r => ({
      id: (r as any)._id,
      batchId: r.batchId,
      sourceImageUrl: r.sourceImageUrl,
      mimeType: r.mimeType,
      status: r.status,
      data: (typeof r.data === 'string') ? safeJsonParse(r.data) : r.data,
      error: r.error,
      createdAt: (r as any).createdAt,
      updatedAt: (r as any).updatedAt,
    }));
  }

  async findOne(id: string): Promise<any | null> {
    const r = await this.draftModel.findById(id).exec();
    if (!r) return null;
    return {
      id: (r as any)._id,
      batchId: r.batchId,
      sourceImageUrl: r.sourceImageUrl,
      mimeType: r.mimeType,
      status: r.status,
      data: (typeof r.data === 'string') ? safeJsonParse(r.data) : r.data,
      error: r.error,
      createdAt: (r as any).createdAt,
      updatedAt: (r as any).updatedAt,
    };
  }

  async remove(id: string): Promise<boolean> {
    const result = await this.draftModel.deleteOne({ _id: id }).exec();
    return result.deletedCount > 0;
  }

  async create(data: Partial<ProductDraftModel>): Promise<ProductDraftDocument> {
    const newDraft = new this.draftModel(data);
    return await newDraft.save();
  }
}

function safeJsonParse(input: string | null): any {
  if (!input) return null;
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}