import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { QueueService } from './queue.service';
import { QueueRecordModel } from './schemas/queue-record.schema';
import { ModuleRef } from '@nestjs/core';
import { MarketplaceIntegrationService } from '../marketplace/services/marketplace-integration.service';

@ApiTags('queues')
@Controller('queues')
export class QueueController {
  private marketplaceIntegrationService: MarketplaceIntegrationService;

  constructor(
    private readonly queueService: QueueService,
    private moduleRef: ModuleRef
  ) {
    // Lazy loading dos serviços para evitar dependências circulares
    setTimeout(() => {
      this.marketplaceIntegrationService = this.moduleRef.get(MarketplaceIntegrationService, { strict: false });
    }, 0);
  }

  @Get('records')
  @ApiOperation({ summary: 'Listar registros de filas' })
  @ApiResponse({ status: 200, description: 'Lista de registros retornada com sucesso' })
  async getQueueRecords(
    @Query('status') status?: string,
    @Query('marketplaceId') marketplaceId?: number,
    @Query('productId') productId?: number | string,
    @Query('type') type?: string,
  ): Promise<QueueRecordModel[]> {
    const filters: any = {};

    if (status) filters.status = status;
    if (marketplaceId) filters.marketplaceId = marketplaceId;
    if (productId) filters.productId = productId;
    if (type) filters.type = type;

    return this.queueService.getQueueRecords(filters);
  }

  @Get('records/:id')
  @ApiOperation({ summary: 'Obter um registro de fila pelo ID' })
  @ApiResponse({ status: 200, description: 'Registro encontrado com sucesso' })
  @ApiResponse({ status: 404, description: 'Registro não encontrado' })
  async getQueueRecordById(@Param('id') id: string): Promise<QueueRecordModel> {
    return this.queueService.getQueueRecordById(id);
  }

  @Get('statistics')
  @ApiOperation({ summary: 'Obter estatísticas das filas' })
  @ApiResponse({ status: 200, description: 'Estatísticas retornadas com sucesso' })
  async getQueueStatistics(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ): Promise<any> {
    return this.queueService.getQueueStatistics(
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
    );
  }

  @Post('retry/:id')
  @ApiOperation({ summary: 'Tentar novamente um registro de fila' })
  @ApiResponse({ status: 200, description: 'Registro adicionado à fila novamente' })
  async retryQueueRecord(@Param('id') id: string): Promise<any> {
    const queueRecord = await this.queueService.getQueueRecordById(id);

    if (queueRecord.type === 'marketplace-integration') {
      await this.queueService.addToMarketplaceQueue(queueRecord.metadata);
    } else if (queueRecord.type === 'product-update') {
      await this.queueService.addToProductQueue(queueRecord.metadata);
    }

    await this.queueService.updateQueueRecord(id, {
      status: 'pending',
      error: undefined, // Fix undefined vs null if compatible
      completedAt: undefined,
    });

    return { success: true, message: 'Registro adicionado à fila novamente' };
  }

  // POST /queues/orders/sync removido — a fila 'orders-sync' (bulk) foi aposentada.
  // Sync manual de pedido: POST /orders/syncc ou /orders/sync/request (ingest direto).
  // Reconciliação automática: OrderReconciler (cursor + delta).
}
