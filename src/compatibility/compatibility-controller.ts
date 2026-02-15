// Controller atualizado com melhor tratamento de erros
import { Controller, Get, Query, Post, Body, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { CompatibilityService } from './compatibility.service';
import { GetCompatibilityFiltersDto } from './dto/get-compatibility-filters.dto';

@Controller('compatibility')
export class CompatibilityController {
  private readonly logger = new Logger(CompatibilityController.name);

  constructor(
    private readonly compatibilityService: CompatibilityService
  ) {}

  // Endpoint adicional para testar conectividade
  @Get('health')
  async healthCheck() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'compatibility'
    };
  }

  // Novo endpoint para adicionar compatibilidade de veículos
  @Post('add-compatibility')
  async addVehicleCompatibility(@Body() body: { 
    titleId: string; 
    vehicleIds: string[];
    vehicleDetails?: Array<{
      id: string;
      name?: string;
      brand?: string;
      model?: string;
      year?: string;
      version?: string;
      engine?: string;
      fuelType?: string;
      transmission?: string;
    }>;
  }) {
    try {
      const { titleId, vehicleIds, vehicleDetails } = body;
      
      if (!titleId) {
        throw new HttpException('titleId é obrigatório', HttpStatus.BAD_REQUEST);
      }
      
      if (!vehicleIds || vehicleIds.length === 0) {
        throw new HttpException('vehicleIds é obrigatório e deve conter pelo menos um ID', HttpStatus.BAD_REQUEST);
      }

      const result = await this.compatibilityService.addVehicleCompatibility(titleId, vehicleIds, vehicleDetails);
      
      return {
        message: 'Compatibilidade adicionada com sucesso',
        titleId,
        vehicleCount: vehicleIds.length,
        result
      };
    } catch (error) {
      this.logger.error('Erro no endpoint add-compatibility:', error);
      throw new HttpException(
        error.message || 'Erro ao adicionar compatibilidade',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}