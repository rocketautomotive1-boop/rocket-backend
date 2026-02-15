import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { MonitoringService } from './monitoring.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('monitoring')
@Controller('monitoring')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class MonitoringController {
  constructor(private readonly monitoringService: MonitoringService) {}

  @Get('queues')
  @ApiOperation({ summary: 'Visualizar status das filas' })
  @ApiResponse({ status: 200, description: 'Status das filas retornado com sucesso' })
  async getQueueStatus() {
    return this.monitoringService.getQueueStatus();
  }

  @Get('metrics')
  @ApiOperation({ summary: 'Obter métricas do sistema' })
  @ApiResponse({ status: 200, description: 'Métricas retornadas com sucesso' })
  async getMetrics() {
    return this.monitoringService.getMetrics();
  }

  @Get('health')
  @ApiOperation({ summary: 'Verificar saúde do sistema' })
  @ApiResponse({ status: 200, description: 'Sistema saudável' })
  @ApiResponse({ status: 503, description: 'Sistema com problemas' })
  async checkHealth() {
    return this.monitoringService.checkHealth();
  }

  @Get('logs')
  @ApiOperation({ summary: 'Visualizar logs do sistema' })
  @ApiResponse({ status: 200, description: 'Logs retornados com sucesso' })
  async getLogs() {
    return this.monitoringService.getLogs();
  }

  @Post('clean-queues')
  @ApiOperation({ summary: 'Limpar filas antigas' })
  @ApiResponse({ status: 200, description: 'Filas limpas com sucesso' })
  async cleanQueues() {
    return this.monitoringService.cleanQueues();
  }
}
