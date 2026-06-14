import { Injectable, Logger } from '@nestjs/common';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as WebSocket from 'ws';
import { RembgJob, RembgJobDocument } from './schemas/rembg-job.schema';
import { ProcessedImageService } from '../processed-image/processed-image.service';
import { RembgGateway } from './rembg.gateway';
import { S3Service } from '../common/s3/s3.service';

type RembgJobMsg = {
  jobId: string;
  productId: string;
  rawS3Key: string;
  batchCode: string;
  batchNote?: string | null;
};

const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [30_000, 60_000, 120_000];

@Injectable()
export class RembgJobConsumer {
  private readonly logger = new Logger(RembgJobConsumer.name);

  constructor(
    @InjectModel(RembgJob.name)
    private readonly rembgJobModel: Model<RembgJobDocument>,
    private readonly processedImageService: ProcessedImageService,
    private readonly rembgGateway: RembgGateway,
    private readonly s3Service: S3Service,
    private readonly amqpConnection: AmqpConnection,
  ) {}

  @RabbitSubscribe({
    exchange: 'rocket.rembg',
    routingKey: 'rembg.process',
    queue: 'rembg.process',
    queueOptions: { durable: true },
    allowNonJsonMessages: false,
  })
  async handleRembgJob(msg: RembgJobMsg): Promise<void> {
    this.logger.log(`Processing rembg job ${msg.jobId} for product ${msg.productId}`);

    const job = await this.rembgJobModel.findByIdAndUpdate(
      msg.jobId,
      { $set: { status: 'processing' } },
      { new: true },
    );
    if (!job) {
      this.logger.warn(`Job ${msg.jobId} not found, skipping`);
      return;
    }

    const pythonWsUrl = process.env.REMBG_WS_URL || 'ws://localhost:5000/ws';

    try {
      const result = await this.callRembgService(pythonWsUrl, msg.rawS3Key, {
        product_id: msg.productId,
        batchCode: msg.batchCode,
        batchNote: msg.batchNote || null,
        options: {
          crop: true,
          shadow: true,
          padding: 10,
          target_size: 1000,
          alpha_matting: true,
          clahe: false,
          model: 'isnet-general-use',
        },
      });

      if (result?.status === 'success' && result.url && result.key) {
        await this.processedImageService.saveProcessedImage({
          batchCode: msg.batchCode,
          batchNote: msg.batchNote || null,
          productId: msg.productId,
          url: result.url,
          key: result.key,
          mimeType: 'image/png',
          source: 'isnet-general-use',
        });

        await this.s3Service.deleteFile(msg.rawS3Key).catch(e =>
          this.logger.warn(`Failed to delete raw S3 file ${msg.rawS3Key}: ${e.message}`),
        );

        await this.rembgJobModel.findByIdAndUpdate(msg.jobId, {
          $set: { status: 'done', processedImageKey: result.key },
        });

        this.rembgGateway.server.emit('rembg:job:done', {
          productId: msg.productId,
          jobId: msg.jobId,
          imageUrl: result.url,
          key: result.key,
        });

        this.logger.log(`Rembg job ${msg.jobId} completed successfully`);
      } else {
        throw new Error(`Rembg service returned error: ${result?.message || 'unknown'}`);
      }
    } catch (err: any) {
      const attempts = (job.attempts ?? 0) + 1;
      this.logger.error(`Rembg job ${msg.jobId} failed (attempt ${attempts}): ${err.message}`);

      if (attempts < MAX_ATTEMPTS) {
        const delayMs = RETRY_DELAYS_MS[attempts - 1] ?? 120_000;
        await this.rembgJobModel.findByIdAndUpdate(msg.jobId, {
          $set: { status: 'pending', attempts, nextRetryAt: new Date(Date.now() + delayMs) },
        });
        setTimeout(() => {
          this.amqpConnection.publish('rocket.rembg', 'rembg.process', msg).catch(e =>
            this.logger.error(`Failed to republish rembg job ${msg.jobId}: ${e.message}`),
          );
        }, delayMs);
      } else {
        await this.rembgJobModel.findByIdAndUpdate(msg.jobId, {
          $set: { status: 'failed', attempts },
        });
        this.rembgGateway.server.emit('rembg:job:failed', {
          productId: msg.productId,
          jobId: msg.jobId,
          attempt: attempts,
        });
      }
    }
  }

  private callRembgService(wsUrl: string, rawS3Key: string, metadata: any): Promise<any> {
    return new Promise(async (resolve) => {
      let resolved = false;
      const safeResolve = (v: any) => { if (!resolved) { resolved = true; resolve(v); } };

      const rawUrl = `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_S3_REGION}.amazonaws.com/${rawS3Key}`;
      let imageBuffer: Buffer;
      try {
        const resp = await fetch(rawUrl);
        if (!resp.ok) throw new Error(`S3 fetch failed: ${resp.status}`);
        imageBuffer = Buffer.from(await resp.arrayBuffer());
      } catch (e: any) {
        safeResolve({ status: 'error', message: `Failed to fetch raw image: ${e.message}` });
        return;
      }

      const ws = new WebSocket(wsUrl);
      const timeout = setTimeout(() => {
        ws.terminate();
        safeResolve({ status: 'error', message: 'Timeout' });
      }, 90_000);

      ws.on('open', () => {
        ws.send(JSON.stringify(metadata));
        ws.send(imageBuffer);
      });
      ws.on('message', (data) => {
        clearTimeout(timeout);
        try { safeResolve(JSON.parse(data.toString())); } catch { safeResolve({ status: 'error', message: 'Invalid JSON' }); }
        ws.close();
      });
      ws.on('error', (e) => { clearTimeout(timeout); safeResolve({ status: 'error', message: e.message }); });
      ws.on('close', () => { clearTimeout(timeout); safeResolve({ status: 'error', message: 'WS closed unexpectedly' }); });
    });
  }
}
