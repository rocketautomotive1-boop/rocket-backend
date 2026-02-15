import { Controller, Post, Get, Delete, Body, Param, HttpException, HttpStatus } from '@nestjs/common';
import { ProductCompatibilityService } from '../services/product-compatibility.service';
import { CreateCompatibilityDto, CreateMultipleCompatibilitiesDto } from '../dto/create-compatibility.dto';

@Controller('product-compatibilities')
export class ProductCompatibilityController {
  constructor(
    private readonly compatibilityService: ProductCompatibilityService,
  ) { }

  @Post()
  async createCompatibility(@Body() createDto: CreateCompatibilityDto) {
    try {
      return await this.compatibilityService.createCompatibility(createDto);
    } catch (error) {
      throw new HttpException(
        error.message || 'Erro ao criar compatibilidade',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post('multiple')
  async createMultipleCompatibilities(@Body() createDto: CreateMultipleCompatibilitiesDto) {
    try {
      return await this.compatibilityService.createMultipleCompatibilities(createDto);
    } catch (error) {
      throw new HttpException(
        error.message || 'Erro ao criar compatibilidades',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('product/:productId')
  async getCompatibilitiesByProduct(@Param('productId') productId: string) {
    try {
      return await this.compatibilityService.getCompatibilitiesByProduct(productId);
    } catch (error) {
      throw new HttpException(
        error.message || 'Erro ao buscar compatibilidades',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Delete(':id')
  async deleteCompatibility(@Param('id') id: string) {
    try {
      await this.compatibilityService.deleteCompatibility(parseInt(id));
      return { message: 'Compatibilidade deletada com sucesso' };
    } catch (error) {
      throw new HttpException(
        error.message || 'Erro ao deletar compatibilidade',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post('mark-synced')
  async markAsSynced(@Body() body: { ids: number[] }) {
    try {
      await this.compatibilityService.markAsSynced(body.ids);
      return { message: 'Compatibilidades marcadas como sincronizadas' };
    } catch (error) {
      throw new HttpException(
        error.message || 'Erro ao marcar como sincronizadas',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}