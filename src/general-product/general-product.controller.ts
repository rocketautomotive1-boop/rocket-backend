import { Controller, Post, Get, Param, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { GeneralDiscoveryService } from './services/general-discovery.service';
import { GeneralProductRepository } from './general-product.repository';

/**
 * API de itens gerais (saúde, beleza, bebidas, alimentos). Cadastro/enriquecimento
 * por código de barras (EAN/GTIN). Persiste no banco `general` (rhamany_eshop).
 */
@ApiTags('general-product')
@Controller('general-product')
export class GeneralProductController {
  constructor(
    private readonly discovery: GeneralDiscoveryService,
    private readonly repo: GeneralProductRepository,
  ) {}

  /** Dispara o discovery de um item geral por barcode. Retorna o jobId. */
  @Post('discover/:barcode')
  @ApiOperation({ summary: 'Dispara discovery de item geral por barcode (EAN-13)' })
  async discover(@Param('barcode') barcode: string): Promise<{ jobId: string; barcode: string }> {
    const jobId = await this.discovery.startByBarcode(barcode);
    return { jobId, barcode };
  }

  /** Consulta o item geral (e seu draftData de discovery) por barcode. */
  @Get('by-barcode/:barcode')
  @ApiOperation({ summary: 'Consulta item geral por barcode' })
  async byBarcode(@Param('barcode') barcode: string) {
    const product = await this.repo.findByBarcode(barcode);
    if (!product) throw new NotFoundException(`Nenhum item geral com barcode ${barcode}`);
    return product;
  }
}
