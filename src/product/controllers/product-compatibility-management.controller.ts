import { Controller, Get, Post, Delete, Body, Param, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ProductService } from '../product.service';

@Controller('products')
export class ProductCompatibilityManagementController {
  private readonly logger = new Logger(ProductCompatibilityManagementController.name);

  constructor(
    private readonly productService: ProductService,
  ) { }

  @Get(':productId/compatibilities')
  async getProductCompatibilities(@Param('productId') productId: string) {
    try {
      return await this.productService.getProductCompatibilities(productId);
    } catch (error) {
      this.logger.error('Erro ao buscar compatibilidades do produto:', error);
      throw new HttpException(
        error.message || 'Erro ao buscar compatibilidades',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get(':productId/compatibilities/stats')
  async getCompatibilityStats(@Param('productId') productId: string) {
    try {
      return await this.productService.getCompatibilityStats(productId);
    } catch (error) {
      this.logger.error('Erro ao buscar estatísticas de compatibilidade:', error);
      throw new HttpException(
        error.message || 'Erro ao buscar estatísticas',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post(':productId/compatibilities')
  async addProductCompatibilities(
    @Param('productId') productId: string,
    @Body() body: {
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
    }
  ) {
    try {
      const { vehicleIds, vehicleDetails } = body;

      if (!vehicleIds || vehicleIds.length === 0) {
        throw new HttpException('vehicleIds é obrigatório', HttpStatus.BAD_REQUEST);
      }

      return await this.productService.addProductCompatibilities(
        productId,
        vehicleIds,
        vehicleDetails
      );
    } catch (error) {
      this.logger.error('Erro ao adicionar compatibilidades ao produto:', error);
      throw new HttpException(
        error.message || 'Erro ao adicionar compatibilidades',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Delete(':productId/compatibilities/:compatibilityId')
  async removeProductCompatibility(
    @Param('productId') productId: string,
    @Param('compatibilityId') compatibilityId: string
  ) {
    try {
      await this.productService.removeProductCompatibility(
        productId,
        compatibilityId
      );

      return { message: 'Compatibilidade removida com sucesso' };
    } catch (error) {
      this.logger.error('Erro ao remover compatibilidade do produto:', error);
      throw new HttpException(
        error.message || 'Erro ao remover compatibilidade',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post(':productId/compatibilities/sync/:marketplaceId')
  async syncCompatibilitiesWithMarketplace(
    @Param('productId') productId: string,
    @Param('marketplaceId') marketplaceId: string
  ) {
    try {
      return await this.productService.syncCompatibilitiesWithMarketplace(
        productId,
        marketplaceId
      );
    } catch (error) {
      this.logger.error('Erro ao sincronizar compatibilidades com marketplace:', error);
      throw new HttpException(
        error.message || 'Erro ao sincronizar compatibilidades',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post(':productId/compatibilities/sync/:marketplaceId/direct')
  async syncDirectCompatibilities(
    @Param('productId') productId: string,
    @Param('marketplaceId') marketplaceId: string,
    @Body() body: { vehicleIds: string[] }
  ) {
    try {
      return await this.productService.syncSpecificCompatibilitiesWithMarketplace(
        productId,
        marketplaceId,
        body?.vehicleIds || []
      );
    } catch (error) {
      this.logger.error('Erro ao sincronizar compatibilidades diretas com marketplace:', error);
      throw new HttpException(
        error.message || 'Erro ao sincronizar compatibilidades diretas',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}