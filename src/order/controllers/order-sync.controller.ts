import { Controller, Post, Body, BadRequestException } from '@nestjs/common';
import { OrderIngestService } from '../ingest/order-ingest.service';

@Controller('orders/sync')
export class OrderSyncController {
    constructor(private readonly ingest: OrderIngestService) { }

    /**
     * Manual trigger endpoint for order sync.
     * Frontend can call this to request sync instead of doing it directly.
     */
    @Post('request')
    async requestSync(@Body() body: { externalId: string; marketplaceId: string }) {
        const { externalId, marketplaceId } = body;

        if (!externalId || !marketplaceId) {
            throw new BadRequestException('externalId and marketplaceId are required');
        }

        try {
            await this.ingest.ingest(externalId, marketplaceId, 'manual');
            return { message: 'Sync requested successfully', externalId, status: 'processing' };
        } catch (error) {
            throw new BadRequestException((error as Error).message);
        }
    }
}
