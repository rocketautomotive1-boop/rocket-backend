import { Controller, Get, Query, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { ProductPublicationLogService } from '../services/product-publication-log.service';
import { ProductPublicationLogModel as ProductPublicationLog } from '../schemas/product-publication-log.schema';

@ApiTags('Product Publication Logs')
@Controller('products/publication-logs')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ProductPublicationLogController {
  constructor(
    private readonly publicationLogService: ProductPublicationLogService,
  ) { }

  @Get('recent')
  @ApiOperation({ summary: 'Get recent publication logs' })
  @ApiResponse({ status: 200, description: 'Recent publication logs retrieved successfully' })
  async getRecentLogs(
    @Query('limit') limit: number = 50,
    @Query('userId') userId?: number,
  ): Promise<ProductPublicationLog[]> {
    return this.publicationLogService.getRecentLogs(limit, userId);
  }

  @Get('product/:productId')
  @ApiOperation({ summary: 'Get publication logs for a specific product' })
  @ApiResponse({ status: 200, description: 'Product publication logs retrieved successfully' })
  async getLogsByProduct(
    @Param('productId', ParseIntPipe) productId: number,
    @Query('limit') limit: number = 50,
  ): Promise<ProductPublicationLog[]> {
    return this.publicationLogService.getLogsByProduct(String(productId), limit);
  }

  @Get('job/:jobId')
  @ApiOperation({ summary: 'Get publication logs for a specific job' })
  @ApiResponse({ status: 200, description: 'Job publication logs retrieved successfully' })
  async getLogsByJob(@Param('jobId') jobId: string): Promise<ProductPublicationLog[]> {
    return this.publicationLogService.getLogsByJob(jobId);
  }

  @Get('stats/:productId')
  @ApiOperation({ summary: 'Get publication statistics for a product' })
  @ApiResponse({ status: 200, description: 'Publication statistics retrieved successfully' })
  async getPublicationStats(@Param('productId', ParseIntPipe) productId: number) {
    return this.publicationLogService.getPublicationStats(String(productId));
  }
}
