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
}
