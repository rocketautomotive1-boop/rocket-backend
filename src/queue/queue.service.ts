import { Injectable, Inject } from '@nestjs/common';

import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ClientProxy } from '@nestjs/microservices';
import { lastValueFrom, timeout, TimeoutError } from 'rxjs';
import { QueueRecordModel, QueueRecordDocument } from './schemas/queue-record.schema';

import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class QueueService {
  constructor(
    @InjectModel(QueueRecordModel.name)
    private queueRecordModel: Model<QueueRecordDocument>,

    @Inject('MARKETPLACE_SERVICE')
    private marketplaceClient: ClientProxy,
    @Inject('PRODUCT_SERVICE')
    private productClient: ClientProxy,
    private eventEmitter: EventEmitter2,
  ) { }

  async addToQueue(data: {
    type: string;
    productId?: string;
    marketplaceId?: string;
    attemptId?: string;
    priority?: number;
    metadata?: Record<string, any>;
  }): Promise<QueueRecordModel> {
    const productIdStr = data.productId ? data.productId.toString() : undefined;

    // R2: DEBOUNCING INTELIGENTE COM TIME WINDOW
    const DEBOUNCE_WINDOW_MS = 5000;
    const windowStart = new Date(Date.now() - DEBOUNCE_WINDOW_MS);

    const existing = await this.queueRecordModel.findOne({
      type: data.type,
      status: 'pending',
      productId: productIdStr,
      marketplaceId: data.marketplaceId
    }).sort({ createdAt: -1 }).exec();

    if (existing && existing.createdAt >= windowStart) {
      console.log(`[QueueService] Debouncing ${data.type} for Product ${data.productId} (Record ${existing._id} created recently)`);

      const updatedMetadata = {
        ...(existing.metadata || {}),
        triggers: [
          ...((existing.metadata as any)?.triggers || []),
          data.metadata?.triggeredBy || data.metadata?.source || 'unknown'
        ],
        lastUpdated: new Date().toISOString(),
        debounceCount: ((existing.metadata as any)?.debounceCount || 0) + 1
      };

      // If existing record doesn't have attemptId but new one does, update it (though usually latest wins)
      if (data.attemptId && !existing.attemptId) {
        existing.attemptId = data.attemptId;
      }

      const newPriority = Math.max(existing.priority || 0, data.priority || 0);

      existing.metadata = updatedMetadata;
      existing.priority = newPriority;
      await existing.save();

      console.log(`[QueueService] Job ${existing._id} updated: priority ${newPriority}, triggers grouped`);

      // Re-emit logic (simplified)
      const pattern = data.type;
      const formattedPayload = {
        id: Date.now().toString(),
        data: { ...data, queueRecordId: existing._id }
      };
      this.emitEvent(pattern, formattedPayload);

      return existing;
    }

    // Create new record
    const queueRecord = new this.queueRecordModel({
      type: data.type,
      status: 'pending',
      priority: data.priority || 0,
      metadata: data.metadata || {},
      productId: productIdStr,
      marketplaceId: data.marketplaceId,
      attemptId: data.attemptId
    });

    const savedRecord = await queueRecord.save();

    // Emit local event
    this.eventEmitter.emit('queue.job.update', {
      jobId: savedRecord._id.toString(),
      productId: data.productId,
      status: 'pending',
      type: data.type,
      timestamp: new Date()
    });

    // Send to RabbitMQ
    const pattern = data.type;
    const formattedPayload = {
      id: Date.now().toString(),
      data: { ...data, queueRecordId: savedRecord._id }
    };

    console.log(`[Queue] New job #${savedRecord._id}: ${pattern} (P${savedRecord.priority})`);
    this.emitEvent(pattern, formattedPayload);

    return savedRecord;
  }

  private async emitEvent(pattern: string, payload: any) {
    if (pattern.startsWith('product-') || pattern.startsWith('product.')) {
      try {
        await lastValueFrom(this.productClient.emit(pattern, payload.data).pipe(timeout(5000)));
      } catch (err) {
        console.error(`[QueueService] Error emitting ${pattern} to PRODUCT_SERVICE:`, err);
      }
    } else if (pattern.startsWith('marketplace-') || pattern === 'orders-sync') {
      try {
        await lastValueFrom(this.marketplaceClient.emit(pattern, payload.data).pipe(timeout(2000)));
      } catch (err) {
        console.error(`[QueueService] Error emitting ${pattern} to MARKETPLACE_SERVICE:`, err instanceof TimeoutError ? 'Timeout (2s)' : (err as any)?.message || err);
      }
    }
  }

  async addToProductQueue(data: any): Promise<QueueRecordModel> {
    return this.addToQueue({
      type: data.type || 'product-create',
      productId: data.productId,
      metadata: data,
      priority: data.priority || 0,
    });
  }

  async addToMarketplaceQueue(data: any): Promise<QueueRecordModel> {
    return this.addToQueue({
      type: 'marketplace-integration',
      productId: data.productId,
      marketplaceId: data.marketplaceId,
      metadata: data,
      priority: data.priority || 0,
    });
  }

  async updateQueueRecord(id: string, data: Partial<QueueRecordModel>): Promise<QueueRecordModel> {
    const updated = await this.queueRecordModel.findByIdAndUpdate(id, { $set: data }, { new: true }).exec();

    if (updated) {
      this.eventEmitter.emit('queue.job.update', {
        jobId: updated._id.toString(),
        productId: updated.productId,
        status: updated.status,
        result: updated.result,
        error: updated.error,
        timestamp: new Date()
      });
    }
    return updated;
  }

  async handleProcessFailure(id: string, error: string): Promise<QueueRecordModel> {
    const record = await this.queueRecordModel.findById(id).exec();
    if (!record) return null;

    const attempts = (record.attempts || 0) + 1;
    const maxAttempts = record.maxAttempts || 3;

    if (attempts < maxAttempts) {
      // Retry: set back to pending
      const updated = await this.updateQueueRecord(id, {
        status: 'pending',
        error: `Attempt ${attempts} failed: ${error}`,
        attempts: attempts
      });

      // Re-emit for retry
      const pattern = record.type;
      const formattedPayload = {
        id: Date.now().toString(),
        data: {
          type: record.type,
          productId: record.productId,
          marketplaceId: record.marketplaceId,
          metadata: record.metadata,
          queueRecordId: record._id
        }
      };
      this.emitEvent(pattern, formattedPayload);

      return updated;
    } else {
      // Permanently failed
      return this.updateQueueRecord(id, {
        status: 'failed',
        error: `Failed after ${attempts} attempts: ${error}`,
        attempts: attempts
      });
    }
  }

  async getQueueRecords(filters: {
    type?: string;
    status?: string;
    productId?: number | string;
    marketplaceId?: number;
    startDate?: Date;
    endDate?: Date;
  }): Promise<QueueRecordModel[]> {
    const query: any = {};
    if (filters.type) query.type = filters.type;
    if (filters.status) query.status = filters.status;
    if (filters.productId) query.productId = filters.productId.toString();
    if (filters.marketplaceId) query.marketplaceId = filters.marketplaceId;
    if (filters.startDate || filters.endDate) {
      query.createdAt = {};
      if (filters.startDate) query.createdAt.$gte = filters.startDate;
      if (filters.endDate) query.createdAt.$lte = filters.endDate;
    }

    return this.queueRecordModel.find(query).sort({ createdAt: -1 }).exec();
  }

  async getQueueRecordById(id: string): Promise<QueueRecordModel> {
    return this.queueRecordModel.findById(id).exec();
  }

  async getQueueStatistics(startDate?: Date, endDate?: Date): Promise<any> {
    // Implement simple stat aggregation
    const query: any = {};
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = startDate;
      if (endDate) query.createdAt.$lte = endDate;
    }
    const records = await this.queueRecordModel.find(query).select('status type marketplaceId').exec();

    const stats = {
      total: records.length,
      byStatus: {},
      byType: {},
      byMarketplace: {},
    };

    records.forEach(r => {
      stats.byStatus[r.status] = (stats.byStatus[r.status] || 0) + 1;
      stats.byType[r.type] = (stats.byType[r.type] || 0) + 1;
      // Marketplace name lookup would require separate query or population if we had it.
      // For now just ID
      if (r.marketplaceId) {
        stats.byMarketplace[r.marketplaceId] = (stats.byMarketplace[r.marketplaceId] || 0) + 1;
      }
    });
    return stats;
  }

  async getQueueStatus(): Promise<any> {
    const agg = await this.queueRecordModel.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);
    const result: any = { total: 0, pending: 0, processing: 0, completed: 0, failed: 0 };
    agg.forEach(item => {
      result[item._id] = item.count;
      result.total += item.count;
    });
    return result;
  }

  async cleanupOldRecords(daysToKeep: number = 30): Promise<number> {
    const date = new Date();
    date.setDate(date.getDate() - daysToKeep);
    const result = await this.queueRecordModel.deleteMany({
      status: { $in: ['completed', 'failed'] },
      createdAt: { $lt: date }
    }).exec();
    return result.deletedCount;
  }

  async startJob(id: string): Promise<QueueRecordModel> {
    const record = await this.queueRecordModel.findById(id).exec();
    if (!record) throw new Error(`Job ${id} not found`);

    return this.queueRecordModel.findByIdAndUpdate(id, {
      status: 'processing',
      startedAt: new Date(),
      attempts: (record.attempts || 0) + 1
    }, { new: true }).exec();
  }

  async completeJob(id: string, result: any): Promise<QueueRecordModel> {
    return this.queueRecordModel.findByIdAndUpdate(id, {
      status: 'completed',
      completedAt: new Date(),
      result: result
    }, { new: true }).exec();
  }

  async failJob(id: string, error: string, result?: any): Promise<QueueRecordModel> {
    return this.queueRecordModel.findByIdAndUpdate(id, {
      status: 'failed',
      completedAt: new Date(),
      error: error,
      result: result
    }, { new: true }).exec();
  }


}
