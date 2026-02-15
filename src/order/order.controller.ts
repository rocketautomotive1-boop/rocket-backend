import { Controller, Get, Post, Body, Param, Query, NotFoundException, BadRequestException, HttpCode } from '@nestjs/common';
import { OrderService } from './order.service';
import { ProductRepository } from '../product/product.repository';

@Controller('orders')
export class OrderController {
    constructor(
        private readonly orderService: OrderService,
        private readonly productRepository: ProductRepository
    ) { }

    @Post('syncc')
    @HttpCode(202)
    async syncOrder(@Body() body: { externalId: string; marketplaceId: string; skipLogistics?: boolean }) {
        const result = await this.orderService.enqueueSyncOrder(body.externalId, body.marketplaceId);
        if (result.isFailure) throw new BadRequestException(result.error);
        return { message: 'Order sync accepted', status: 'processing', ...result.getValue() };
    }

    @Get('debug-stock/:externalId')
    async debugStock(@Param('externalId') externalId: string) {
        const trimmedId = externalId.trim();
        const movements = await this.productRepository.findMovementsByReferences([trimmedId]);
        const directFind = await this.productRepository.existsMovementReference(trimmedId);

        return {
            input: externalId,
            trimmed: trimmedId,
            repo_findMovementsByReferences: movements,
            repo_existsMovementReference: directFind,
            message: movements.length > 0 ? 'LOGIC WORKING' : 'LOGIC FAILING'
        };
    }

    @Get()
    async findAlll(
        @Query('page') page: number = 1,
        @Query('limit') limit: number = 50,
        @Query('offset') offset?: number,
        @Query('q') search?: string
    ) {
        // Support both page-based and offset-based pagination
        const actualOffset = offset !== undefined ? offset : (page - 1) * limit;
        return await this.orderService.findAll(actualOffset, limit, search);
    }

    @Get(':id')
    async findOne(@Param('id') id: string) {
        const result = await this.orderService.getOrder(id);
        if (result.isFailure) throw new NotFoundException(result.error);
        return result.getValue();
    }

    @Post(':id/note')
    async addNote(@Param('id') id: string, @Body() body: { message: string }) {
        const result = await this.orderService.addNote(id, body.message);
        if (result.isFailure) throw new BadRequestException(result.error);
        return result.getValue();
    }

    @Get(':id/separation')
    async getSeparationList(@Param('id') id: string) {
        return await this.orderService.getSeparationList(id);
    }

    @Post(':id/enrich-billing')
    async enrichBilling(@Param('id') id: string) {
        const result = await this.orderService.enrichBillingData(id);
        if (result.isFailure) throw new BadRequestException(result.error);
        return result.getValue();
    }

    @Get('external/:id')
    async findByExternalId(@Param('id') id: string) {
        const result = await this.orderService.getOrderByExternalId(id);
        if (result.isFailure) throw new NotFoundException(result.error);
        return result.getValue();
    }

    @Post(':id/picking/validate')
    async validatePicking(@Param('id') id: string, @Body() body: { code: string }) {
        const result = await this.orderService.validatePickingScan(id, body.code);
        if (result.isFailure) throw new BadRequestException(result.error);
        return result.getValue();
    }

    @Post(':id/ignore')
    async ignoreOrder(@Param('id') id: string, @Body() body: { userId?: string }) {
        const result = await this.orderService.ignoreOrder(id, body.userId || 'admin');
        if (result.isFailure) throw new BadRequestException(result.error);
        return { success: true };
    }

    @Post(':id/complete-picking')
    async completePicking(@Param('id') id: string, @Body() body: { pickedItems: Record<string, number> }) {
        const result = await this.orderService.completePicking(id, body.pickedItems);
        if (result.isFailure) throw new BadRequestException(result.error);
        return result.getValue();
    }

    @Post(':id/retry-logistics')
    async retryLogistics(@Param('id') id: string, @Body() body: { userId?: string }) {
        const result = await this.orderService.retryLogistics(id, body.userId || 'admin');
        if (result.isFailure) throw new BadRequestException(result.error);
        return { success: true };
    }
}
