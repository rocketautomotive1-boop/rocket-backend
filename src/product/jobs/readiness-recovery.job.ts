import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ProductModel, ProductDocument } from '../schemas/product.schema';
import { OrchestratorPublisherService } from '../../marketplace-orchestrator/orchestrator-publisher.service';
import { ListingService } from '../../listing/listing.service';

@Injectable()
export class ReadinessRecoveryJob {
  private readonly logger = new Logger(ReadinessRecoveryJob.name);

  constructor(
    @InjectModel(ProductModel.name) private readonly productModel: Model<ProductDocument>,
    private readonly orchestratorPublisher: OrchestratorPublisherService,
    private readonly listingService: ListingService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async recover(): Promise<void> {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const candidates = await this.productModel
      .find({
        'completion.readyToPublish': true,
        'completion.completedAt': { $gte: oneHourAgo, $lte: tenMinutesAgo },
      })
      .select('_id')
      .lean()
      .exec();

    if (candidates.length === 0) return;

    this.logger.log(`Recovery: found ${candidates.length} candidate product(s)`);

    for (const candidate of candidates) {
      const productId = candidate._id.toString();
      try {
        const hasActiveListing = await this.listingService.existsActiveForProduct(productId);
        if (hasActiveListing) continue;

        await this.orchestratorPublisher.requestSync({
          productId,
          reason: 'auto_complete_recovery',
          force: false,
        });
        this.logger.log(`Recovery: enqueued sync for product ${productId}`);
      } catch (err) {
        this.logger.error(`Recovery: failed to process product ${productId}: ${(err as Error).message}`);
      }
    }
  }
}
