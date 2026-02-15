import { Controller, Get, Param, Query, ParseIntPipe, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody } from '@nestjs/swagger';
import { PickingService } from './services/picking.service';
import { FreightService } from './freight/freight.service';
import { CreateQuoteDto } from './freight/dto/create-quote.dto';

@ApiTags('Logistics')
@Controller('logistics')
export class LogisticsController {
    constructor(
        private readonly pickingService: PickingService,
        private readonly freightService: FreightService,
    ) { }

    @Get('picking/:orderId')
    @ApiOperation({ summary: 'Get picking list (separation) for an order' })
    async getPickingList(
        @Param('orderId') orderId: string,
        @Query('marketplaceId') marketplaceId: string
    ) {
        return await this.pickingService.getPickingList(orderId, marketplaceId);
    }

    @Post('quote')
    @ApiOperation({ summary: 'Get freight quotes from all available providers' })
    @ApiBody({ type: CreateQuoteDto })
    async getQuote(@Body() dto: CreateQuoteDto) {
        // Map DTO to internal Params
        const postalCode = dto.destinationZip || dto.recipient?.postalCode;
        if (!postalCode) {
            throw new Error('Destination ZIP / Postal Code is required');
        }

        const items = dto.items.map(item => ({
            weight: item.weight,
            length: item.length,
            width: item.width,
            height: item.height,
            price: item.insuranceValue || item.price || 0,
        }));

        // Handle quantity if needed (explode items? sum weight? For now assume explicit items list or quantity=1)
        // If quantity > 1, arguably we should duplicate items, but usually freight APIs take a list.
        // Let's assume the client sends expanded items or we treat 1 item line as 1 package for now.

        return await this.freightService.getQuotes({
            recipient: {
                postalCode,
                countryCode: dto.recipient?.countryCode || 'BR',
                document: dto.recipient?.document,
                street: dto.recipient?.street,
                number: dto.recipient?.number,
                city: dto.recipient?.city,
                state: dto.recipient?.state,
            },
            items,
        });
    }
}
