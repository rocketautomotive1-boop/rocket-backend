import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { S3Service } from '../common/s3/s3.service';
import { RembgJob, RembgJobDocument } from './schemas/rembg-job.schema';

/**
 * Enqueue a durable rembg job. This ONLY records intent — it uploads the raw image to S3
 * and creates a `pending` RembgJob. The RembgDispatchWorker (poller) delivers the work to
 * the microservice; there is no RabbitMQ publish and no in-memory timer here. A reserved
 * product slot always has a matching durable job, so it cannot get stuck 'processing'.
 */
@Injectable()
export class RembgEnqueueService {
  private readonly logger = new Logger(RembgEnqueueService.name);

  constructor(
    @InjectModel(RembgJob.name)
    private readonly rembgJobModel: Model<RembgJobDocument>,
    private readonly s3Service: S3Service,
  ) {}

  async enqueue(params: {
    productId: string;
    slotId: string;
    fileBuffer: Buffer;
    originalName: string;
    mimeType: string;
    batchCode: string;
    batchNote?: string | null;
    options?: Record<string, any> | null;
  }): Promise<{ jobId: string; status: 'queued' }> {
    const rawS3Key = `rembg-raw/${params.productId}/${params.batchCode}/${Date.now()}-${params.originalName}`;

    await this.s3Service.uploadFile(params.fileBuffer, rawS3Key, params.mimeType, true);

    const job = await this.rembgJobModel.create({
      productId: params.productId,
      slotId: params.slotId,
      rawS3Key,
      batchCode: params.batchCode,
      batchNote: params.batchNote ?? null,
      options: params.options ?? null,
      status: 'pending',
      attempts: 0,
    });

    this.logger.log(`Rembg job created: ${job._id} (slot ${params.slotId}) for product ${params.productId}`);
    return { jobId: String(job._id), status: 'queued' };
  }
}
