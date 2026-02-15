import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ProductPublicationLogModel, PublicationStatus } from '../schemas/product-publication-log.schema';
import { Injectable, Logger } from '@nestjs/common';
// Note: We might want to move PublicationStatus enum to schema if entity is deleted, but trying to keep it if it's just an enum export.
// If entity file is gone completely, I need to define the enum here or in schema.

@Injectable()
export class ProductPublicationLogService {
  private readonly logger = new Logger(ProductPublicationLogService.name);

  constructor(
    @InjectModel(ProductPublicationLogModel.name) private publicationLogModel: Model<ProductPublicationLogModel>,
  ) { }

  async createLog(data: {
    productId: string;
    marketplaceId: string;
    marketplaceName: string;
    jobId: string;
    userId?: number;
    requestData?: any;
  }): Promise<any> {
    try {
      const now = new Date();
      // Bucket per day
      const bucketStart = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
      const bucketEnd = new Date(bucketStart.getTime() + 24 * 60 * 60 * 1000 - 1);

      const logEntry = {
        _id: new Types.ObjectId(),
        timestamp: now,
        status: PublicationStatus.PENDING,
        message: `Iniciando publicação em ${data.marketplaceName}`,
        metadata: {
          jobId: data.jobId,
          userId: data.userId,
          requestData: data.requestData
        }
      };

      await this.publicationLogModel.updateOne(
        {
          product: new Types.ObjectId(data.productId),
          marketplace: new Types.ObjectId(data.marketplaceId),
          bucketStart: bucketStart
        },
        {
          $setOnInsert: { bucketEnd: bucketEnd },
          $push: { logs: logEntry },
          $inc: { count: 1 }
        },
        { upsert: true }
      );

      this.logger.log(`Log added to bucket for product ${data.productId} on ${data.marketplaceName}`);
      return logEntry; // Return the single entry, not the whole bucket
    } catch (error) {
      this.logger.error(`Failed to create publication log: ${error.message}`, error.stack);
      throw error;
    }
  }

  async updateLogStatus(
    logId: string | Types.ObjectId,
    status: PublicationStatus,
    data: {
      message?: string;
      responseData?: any;
      errorData?: any;
      externalId?: string;
      processingTimeMs?: number;
      completedAt?: Date;
    } = {}
  ): Promise<void> {
    try {
      // Find the bucket containing the log via 'logs._id'
      await this.publicationLogModel.updateOne(
        { "logs._id": logId },
        {
          $set: {
            "logs.$.status": status,
            "logs.$.message": data.message,
            "logs.$.metadata.responseData": data.responseData,
            "logs.$.metadata.errorData": data.errorData,
            "logs.$.metadata.externalId": data.externalId,
            "logs.$.metadata.processingTimeMs": data.processingTimeMs,
            "logs.$.metadata.completedAt": data.completedAt || new Date()
          }
        }
      );

      this.logger.log(`Log ${logId} updated to status: ${status}`);
    } catch (error) {
      this.logger.error(`Failed to update publication log ${logId}: ${error.message}`, error.stack);
      throw error;
    }
  }

  async getLogsByProduct(productId: string, limit: number = 5): Promise<ProductPublicationLogModel[]> {
    try {
      // Return buckets, sorted by latest
      return await this.publicationLogModel.find({ product: new Types.ObjectId(productId) })
        .sort({ bucketStart: -1 })
        .limit(limit)
        .exec();
    } catch (error) {
      this.logger.error(`Failed to get logs for product ${productId}: ${error.message}`, error.stack);
      throw error;
    }
  }

  async getLogsByJob(jobId: string): Promise<any[]> {
    try {
      // Need to find buckets containing logs with this query
      // This is expensive with buckets if not indexed, but metadata.jobId is inside logs array.
      // Ideally creating a log should have jobId at root if queried often, OR use aggregation.
      // For now, simple find.
      const buckets = await this.publicationLogModel.find({ "logs.metadata.jobId": jobId }).exec();

      // Extract relevant logs
      const logs = [];
      buckets.forEach(bucket => {
        bucket.logs.forEach(log => {
          if (log.metadata?.jobId === jobId) logs.push(log);
        });
      });

      return logs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    } catch (error) {
      this.logger.error(`Failed to get logs for job ${jobId}: ${error.message}`, error.stack);
      throw error;
    }
  }

  async getRecentLogs(limit: number = 20, userId?: number): Promise<ProductPublicationLogModel[]> {
    // Returns recent BUCKETS
    try {
      const query = userId ? { "logs.metadata.userId": userId } : {};
      return await this.publicationLogModel.find(query)
        .sort({ bucketStart: -1 })
        .limit(limit)
        .exec();
    } catch (error) {
      this.logger.error(`Failed to get recent logs: ${error.message}`, error.stack);
      throw error;
    }
  }

  async getLogsByStatus(status: PublicationStatus, limit: number = 50): Promise<any[]> {
    // This is tricky with buckets. Returning buckets containing the status?
    return await this.publicationLogModel.find({ "logs.status": status })
      .sort({ bucketStart: -1 })
      .limit(limit)
      .exec();
  }

  async getPublicationStats(productId: string): Promise<{
    total: number;
    successful: number;
    failed: number;
    pending: number;
    lastPublication: Date | null;
    marketplacesCount: number;
  }> {
    try {
      const buckets = await this.publicationLogModel.find({ product: new Types.ObjectId(productId) });

      let total = 0;
      let successful = 0;
      let failed = 0;
      let pending = 0;
      let lastDate = null;
      const marketplaces = new Set<string>();

      buckets.forEach(bucket => {
        marketplaces.add(bucket.marketplace.toString());
        total += bucket.count;
        bucket.logs.forEach(log => {
          if (log.status === PublicationStatus.SUCCESS) successful++;
          if (log.status === PublicationStatus.ERROR) failed++;
          if (log.status === PublicationStatus.PENDING || log.status === PublicationStatus.PROCESSING) pending++;

          if (!lastDate || new Date(log.timestamp) > lastDate) {
            lastDate = new Date(log.timestamp);
          }
        });
      });

      return {
        total,
        successful,
        failed,
        pending,
        lastPublication: lastDate,
        marketplacesCount: marketplaces.size,
      };
    } catch (error) {
      this.logger.error(`Failed to get publication stats: ${error.message}`);
      throw error;
    }
  }
}
