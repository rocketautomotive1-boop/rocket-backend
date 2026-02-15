import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { StatsService } from '../services/stats.service';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

@Controller('stats')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get('weekly-published-products')
  @ApiTags('Stats')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get weekly published products' })
  @ApiResponse({ status: 200, description: 'Weekly published products' })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @ApiResponse({ status: 500, description: 'Internal Server Error' }) 
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  getWeeklyPublishedProducts(@Req() req: any) {
    const userId = this.statsService.resolveUserIdFromRequest(req);
    return this.statsService.getWeeklyPublishedProducts(userId);
  }

  @Get('inventory-value')
  @ApiTags('Stats')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get inventory value with period filters' })
  @ApiQuery({ name: 'period', required: false, description: 'Period filter: all, today, yesterday, last7days, last15days, last30days, custom' })
  @ApiQuery({ name: 'startDate', required: false, description: 'Start date for custom period (YYYY-MM-DD)' })
  @ApiQuery({ name: 'endDate', required: false, description: 'End date for custom period (YYYY-MM-DD)' })
  @ApiResponse({ status: 200, description: 'Inventory value data' })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @ApiResponse({ status: 500, description: 'Internal Server Error' }) 
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  getInventoryValue(
    @Req() req: any,
    @Query('period') period?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string
  ) {
    const userId = this.statsService.resolveUserIdFromRequest(req);
    return this.statsService.getInventoryValue(period, startDate, endDate, userId);
  }
}