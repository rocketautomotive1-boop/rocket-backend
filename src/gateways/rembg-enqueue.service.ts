import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { S3Service } from '../common/s3/s3.service';
import { RembgJob, RembgJobDocument } from './schemas/rembg-job.schema';

function makeBatchCode(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `RB-${date}-${time}-${suffix}`;
}

@Injectable()
export class RembgEnqueueService {
  private readonly logger = new Logger(RembgEnqueueService.name);

  constructor(
    @InjectModel(RembgJob.name)
    private readonly rembgJobModel: Model<RembgJobDocument>,
    private readonly s3Service: S3Service,
    private readonly amqpConnection: AmqpConnection,
  ) {}

  async enqueue(params: {
    productId: string;
    fileBuffer: Buffer;
    originalName: string;
    mimeType: string;
    batchCode?: string;
    batchNote?: string;
  }): Promise<{ jobId: string; status: 'queued' }> {
    const batchCode = params.batchCode || makeBatchCode();
    const rawS3Key = `rembg-raw/${params.productId}/${batchCode}/${Date.now()}-${params.originalName}`;

    await this.s3Service.uploadFile(params.fileBuffer, rawS3Key, params.mimeType, true);

    const job = await this.rembgJobModel.create({
      productId: params.productId,
      rawS3Key,
      batchCode,
      batchNote: params.batchNote || null,
      status: 'pending',
      attempts: 0,
    });

    await this.amqpConnection.publish('rocket.rembg', 'rembg.process', {
      jobId: String(job._id),
      productId: params.productId,
      rawS3Key,
      batchCode,
      batchNote: params.batchNote || null,
    });

    this.logger.log(`Rembg job enqueued: ${job._id} for product ${params.productId}`);
    return { jobId: String(job._id), status: 'queued' };
  }
}
