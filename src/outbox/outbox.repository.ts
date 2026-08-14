import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { OutboxMessage, OutboxMessageDocument } from './schemas/outbox-message.schema';

export interface EnqueueInput {
  exchange: string;
  routingKey: string;
  payload: Record<string, any>;
}

@Injectable()
export class OutboxRepository {
  constructor(
    @InjectModel(OutboxMessage.name) private readonly model: Model<OutboxMessageDocument>,
  ) {}

  async enqueue(input: EnqueueInput, opts?: { session?: ClientSession }): Promise<void> {
    await this.model.create(
      [{ exchange: input.exchange, routingKey: input.routingKey, payload: input.payload, status: 'pending' }],
      { session: opts?.session },
    );
  }

  async claimBatch(batchSize: number, now: Date): Promise<OutboxMessageDocument[]> {
    const candidates = await this.model
      .find({ status: 'pending', scheduledAt: { $lte: now } })
      .sort({ scheduledAt: 1 })
      .limit(batchSize)
      .select('_id')
      .lean();
    if (!candidates.length) return [];

    const claimId = randomUUID();
    const ids = candidates.map((c: any) => c._id);
    await this.model.updateMany(
      { _id: { $in: ids }, status: 'pending' },
      { $set: { status: 'publishing', claimId, processingStartedAt: now } },
    );
    return this.model.find({ claimId, status: 'publishing' });
  }

  async markPublished(id: string): Promise<void> {
    await this.model.findByIdAndUpdate(id, {
      $set: { status: 'published', publishedAt: new Date(), claimId: null, lastError: null },
    });
  }

  async markFailedOrReschedule(id: string, attempts: number, error: string, backoffSeconds: number): Promise<void> {
    const doc = await this.model.findById(id).select('maxAttempts').lean();
    const maxAttempts = (doc as any)?.maxAttempts ?? 8;
    if (attempts + 1 >= maxAttempts) {
      await this.model.findByIdAndUpdate(id, {
        $set: { status: 'failed', lastError: error, claimId: null }, $inc: { attempts: 1 },
      });
      return;
    }
    await this.model.findByIdAndUpdate(id, {
      $set: {
        status: 'pending',
        scheduledAt: new Date(Date.now() + backoffSeconds * 1000),
        lastError: error,
        claimId: null,
        processingStartedAt: null,
      },
      $inc: { attempts: 1 },
    });
  }

  async recoverStalePublishing(staleMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - staleMs);
    const res = await this.model.updateMany(
      { status: 'publishing', processingStartedAt: { $lt: cutoff } },
      { $set: { status: 'pending', claimId: null, processingStartedAt: null } },
    );
    return res.modifiedCount;
  }
}
