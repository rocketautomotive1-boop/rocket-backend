import { Controller, Post, Get, Put, Param, Body, NotFoundException, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { GeneralDiscoveryService } from './services/general-discovery.service';
import { GeneralProductRepository } from './general-product.repository';
import { GeneralProductService } from './general-product.service';
import { parseUpdatePatch } from './dto/update-general-product.schema';
import { ZodError } from 'zod';

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
    private readonly service: GeneralProductService,
  ) {}

  /** Dispara o discovery de um item geral por barcode. Retorna o jobId. */
  @Post('discover/:barcode')
  @ApiOperation({ summary: 'Dispara discovery de item geral por barcode (EAN-13)' })
  async discover(@Param('barcode') barcode: string): Promise<{ jobId: string; barcode: string }> {
    const jobId = await this.discovery.startByBarcode(barcode);
    return { jobId, barcode };
  }

  /**
   * Garante o Product `domain:'general'` do barcode (cria shell se preciso) e
   * dispara o discovery. Retorna o productId (para navegar ao stepper) + jobId.
   */
  @Post('ensure/:barcode')
  @ApiOperation({ summary: 'Garante o produto geral por barcode + dispara discovery' })
  async ensure(@Param('barcode') barcode: string): Promise<{ productId: string; jobId: string }> {
    const { productId } = await this.service.ensureByBarcode(barcode);
    const jobId = await this.discovery.startByBarcode(barcode);
    return { productId, jobId };
  }

  /** Consulta o item geral (e seu draftData de discovery) por barcode. */
  @Get('by-barcode/:barcode')
  @ApiOperation({ summary: 'Consulta item geral por barcode' })
  async byBarcode(@Param('barcode') barcode: string) {
    const product = await this.repo.findByBarcode(barcode);
    if (!product) throw new NotFoundException(`Nenhum item geral com barcode ${barcode}`);
    return product;
  }

  /** Completude por seção (derivada dos campos finais). Inexistente → tudo false. */
  @Get('by-barcode/:barcode/completion')
  @ApiOperation({ summary: 'Completude por seção de um item geral (por barcode)' })
  async completion(@Param('barcode') barcode: string) {
    return this.service.getCompletion(barcode);
  }

  /** Salva (upsert) os campos confirmados de uma seção. Patch parcial; não toca draftData. */
  @Put('by-barcode/:barcode')
  @ApiOperation({ summary: 'Atualiza (parcial, upsert) um item geral por barcode' })
  async update(@Param('barcode') barcode: string, @Body() body: unknown) {
    let patch;
    try {
      patch = parseUpdatePatch(body);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new BadRequestException(error.issues[0]?.message ?? 'Dados inválidos.');
      }
      throw error;
    }
    return this.service.updateByBarcode(barcode, patch);
  }
}
