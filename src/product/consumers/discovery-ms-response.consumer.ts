import { Injectable, Logger } from '@nestjs/common';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CategoryResolutionService } from '../services/category-resolution.service';
import { DiscoveryRealtimeEvent, DiscoveryRealtimeStatus } from '../types/discovery-realtime-event';

@Injectable()
export class DiscoveryMsResponseConsumer {
    private readonly logger = new Logger(DiscoveryMsResponseConsumer.name);

    constructor(
        @InjectModel('ProductDiscoveryModel')
        private readonly discoveryModel: Model<any>,
        private readonly eventEmitter: EventEmitter2,
        private readonly categoryResolution: CategoryResolutionService,
    ) {
        this.logger.log('DiscoveryMsResponseConsumer initialized');
    }

    @RabbitSubscribe({
        exchange: 'rocket.inventory',
        routingKey: 'discovery.scraper.response',
        queue: 'discovery.scraper.response',
        queueOptions: { durable: true },
    })
    async handleResponse(msg: any) {
        const { jobId, status, results, error, scrapedAt } = msg;
        this.logger.log(`Received discovery response: jobId=${jobId} status=${status}`);

        const discoveryDoc = await this.discoveryModel
            .findOne({ batchId: jobId })
            .select('isActiveIntent status')
            .lean()
            .exec();

        if (!discoveryDoc) {
            this.logger.warn(`Ignoring discovery response for unknown jobId=${jobId}`);
            return;
        }

        if (discoveryDoc.isActiveIntent === false || discoveryDoc.status === 'superseded') {
            this.logger.warn(`Ignoring stale discovery response: jobId=${jobId}`);
            return;
        }

        const updateData: any = {
            updatedAt: new Date(scrapedAt || Date.now()),
        };

        if (status === 'completed') {
            updateData.status = 'done';

            // sources: per-source evidence
            // Collect all images from all ML items (not just suggestedImages which may be filtered)
            const allMlImages: string[] = [];
            for (const item of results?.mercadolivre?.items ?? []) {
                for (const img of item.images ?? []) {
                    if (!allMlImages.includes(img)) allMlImages.push(img);
                }
            }
            const mlImages = allMlImages.length > 0
                ? allMlImages
                : (results?.mercadolivre?.suggestedImages ?? []);

            updateData.sources = {
                mercadolivre: {
                    items: results?.mercadolivre?.items ?? [],
                    titles: results?.mercadolivre?.titles ?? [],
                    prices: results?.mercadolivre?.prices ?? null,
                    images: mlImages,
                    breadcrumb: results?.mercadolivre?.breadcrumb ?? null,
                    confidence: results?.mercadolivre?.items?.length > 0 ? 'high' : 'none',
                },
                serp: {
                    items: results?.serp?.items ?? [],
                    confidence: results?.serp?.items?.length > 0 ? 'medium' : 'none',
                },
            };

            const mlPrices = results?.mercadolivre?.prices ?? results?.ai?.prices ?? null;
            const preferredSource = (results?.mercadolivre?.items?.length ?? 0) > 0 ? 'mercadolivre' : 'serp';

            // Deduplicate attributes — prefer AI format {id,key,value} over ML format {name,value_name}
            // Exclude fields managed separately (part number, brand, OEM codes)
            const EXCLUDED_KEYS = new Set(['número de peça', 'marca', 'código oem', 'part number', 'brand', 'oem']);
            const rawAttributes: any[] = results?.attributes ?? results?.ai?.attributes ?? [];
            const attrMap = new Map<string, { id: string; key: string; value: string }>();
            for (const a of rawAttributes) {
                const k: string = (a.key ?? a.name ?? '').trim();
                const v: string = (a.value ?? a.value_name ?? '').trim();
                const id: string = (a.id ?? '').trim();
                if (!k || !v || EXCLUDED_KEYS.has(k.toLowerCase())) continue;
                if (!attrMap.has(k)) attrMap.set(k, { id, key: k, value: v });
            }
            const attributes = Array.from(attrMap.values());

            updateData.final = {
                mode: 'enriched',
                preferredSource,
                titles: results?.titles ?? results?.ai?.titles ?? [],
                prices: mlPrices,
                suggestedImages: mlImages.length > 0 ? mlImages : (results?.suggestedImages ?? results?.mercadolivre?.suggestedImages ?? []),
                description: results?.description ?? results?.ai?.description ?? '',
                details: results?.details ?? results?.ai?.details ?? '',
                attributes,
                oemCodes: results?.oemCodes ?? results?.ai?.oemCodes ?? [],
                vehicles: results?.vehicles ?? results?.ai?.vehicles ?? [],
                categoryPath: results?.categoryPath ?? results?.ai?.categoryPath ?? null,
                breadcrumb: results?.mercadolivre?.breadcrumb ?? null,
                timing: results?.timing ?? null,
                confidence: preferredSource === 'mercadolivre' ? 'high' : 'medium',
            };

            // Resolve category from categoryPath
            try {
                const categoryId = await this.categoryResolution.resolve(updateData.final.categoryPath);
                if (categoryId) {
                    updateData.resolvedCategoryId = categoryId;
                    this.logger.log(`Category resolved for job ${jobId}: ${categoryId}`);
                }
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                this.logger.warn(`Category resolution failed for job ${jobId}: ${message}`);
            }

            // Remove legacy data field if it exists
            await this.discoveryModel.updateOne(
                { batchId: jobId, isActiveIntent: true, status: { $ne: 'superseded' } },
                { $unset: { data: '' } },
            ).exec();

            this.logger.log(`Discovery job ${jobId} → DONE (ml=${results?.mercadolivre?.items?.length ?? 0} serp=${results?.serp?.items?.length ?? 0} attrs=${attributes.length})`);
        } else {
            updateData.status = 'failed';
            updateData.error = error;
            this.logger.error(`Discovery job ${jobId} failed: ${error}`);
        }

        await this.discoveryModel.updateOne(
            { batchId: jobId, isActiveIntent: true, status: { $ne: 'superseded' } },
            { $set: updateData },
        ).exec();

        const realtimeStatus: DiscoveryRealtimeStatus = status === 'completed' ? 'COMPLETED' : 'FAILED';

        const eventResult = realtimeStatus === 'COMPLETED'
            ? {
                ...updateData.final,
                // Attach rawItems so frontend can populate inventory without a REST fetch
                rawItems: updateData.sources?.mercadolivre?.items ?? [],
                resolvedCategoryId: updateData.resolvedCategoryId ?? null,
              }
            : undefined;

        const event: DiscoveryRealtimeEvent = {
            jobId,
            status: realtimeStatus,
            result: eventResult,
            error: updateData.error,
        };
        this.eventEmitter.emit('queue.job.update', event);
    }

    @RabbitSubscribe({
        exchange: 'rocket.inventory',
        routingKey: 'discovery.scraper.progress',
        queue: 'discovery.scraper.progress',
        queueOptions: { durable: true },
    })
    async handleProgress(msg: any) {
        const { jobId, step, message } = msg;
        this.logger.debug(`Discovery progress: jobId=${jobId} step=${step} msg=${message}`);

        const discoveryDoc = await this.discoveryModel
            .findOne({ batchId: jobId })
            .select('isActiveIntent status')
            .lean()
            .exec();
        if (!discoveryDoc || discoveryDoc.isActiveIntent === false || discoveryDoc.status === 'superseded') return;

        const event: DiscoveryRealtimeEvent = {
            jobId,
            status: 'PROCESSING',
            step,
            message,
        };
        this.eventEmitter.emit('queue.job.update', event);
    }
}
