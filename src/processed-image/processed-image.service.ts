import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ProcessedImage,
  ProcessedImageDocument,
} from './schemas/processed-image.schema';

type SaveProcessedImageInput = {
  batchCode: string;
  batchNote?: string | null;
  productId?: string | null;
  url: string;
  key: string;
  mimeType?: string;
  fileName?: string | null;
  source?: string | null;
  /** When set, the save is idempotent by jobId (upsert) — never duplicates a paid result. */
  jobId?: string | null;
};

type ListProcessedImagesInput = {
  batchCode?: string;
  search?: string;
  page: number;
  limit: number;
};

@Injectable()
export class ProcessedImageService {
  constructor(
    @InjectModel(ProcessedImage.name)
    private readonly processedImageModel: Model<ProcessedImageDocument>,
  ) {}

  async saveProcessedImage(input: SaveProcessedImageInput) {
    const fields = {
      batchCode: input.batchCode,
      batchNote: input.batchNote || null,
      productId: input.productId || null,
      url: input.url,
      key: input.key,
      mimeType: input.mimeType || 'image/png',
      fileName: input.fileName || null,
      source: input.source || null,
    };

    // Idempotent path: keyed by jobId so a retried/duplicated success callback upserts
    // the same repository row (the "never lose, never double-charge" guarantee).
    if (input.jobId) {
      const doc = await this.processedImageModel.findOneAndUpdate(
        { jobId: input.jobId },
        { $set: fields, $setOnInsert: { jobId: input.jobId } },
        { new: true, upsert: true },
      );
      return this.toOutput(doc);
    }

    const doc = await this.processedImageModel.create(fields);
    return this.toOutput(doc);
  }

  async listProcessedImages(input: ListProcessedImagesInput) {
    const page = Math.max(1, input.page || 1);
    const limit = Math.min(Math.max(1, input.limit || 30), 100);
    const skip = (page - 1) * limit;

    const filter: Record<string, any> = {};
    if (input.batchCode?.trim()) {
      filter.batchCode = input.batchCode.trim();
    }
    if (input.search?.trim()) {
      const escaped = input.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { batchNote: { $regex: escaped, $options: 'i' } },
        { batchCode: { $regex: escaped, $options: 'i' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.processedImageModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.processedImageModel.countDocuments(filter),
    ]);

    return {
      items: items.map((item) => this.toOutput(item)),
      page,
      limit,
      total,
    };
  }

  private toOutput(item: any) {
    return {
      id: String(item._id),
      url: item.url,
      key: item.key,
      batchCode: item.batchCode,
      batchNote: item.batchNote || null,
      productId: item.productId || null,
      mimeType: item.mimeType || 'image/png',
      fileName: item.fileName || null,
      source: item.source || null,
      jobId: item.jobId || null,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }
}
