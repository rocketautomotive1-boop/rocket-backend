import { Body, Controller, Delete, Get, NotFoundException, Param, Patch, Put } from '@nestjs/common';
import { MarketplaceCredentialsService } from '../../credentials/marketplace-credentials.service';

/**
 * CRUD administrativo de credenciais semi-estáticas por marketplace.
 * NUNCA retorna valores em plaintext via GET — apenas as keys disponíveis.
 * Rotação: PUT /:id/credentials/:key para atualizar uma chave individual.
 */
@Controller('marketplaces')
export class MarketplaceCredentialsController {
  constructor(private readonly credentialsService: MarketplaceCredentialsService) {}

  /**
   * Lista as keys de credenciais configuradas (sem expor valores).
   */
  @Get(':id/credentials')
  async list(@Param('id') id: string): Promise<{ keys: string[] }> {
    const keys = await this.credentialsService.listKeys(id);
    return { keys };
  }

  /**
   * Substitui todas as credenciais de uma vez. Use PUT para semântica idempotente.
   */
  @Put(':id/credentials')
  async setAll(
    @Param('id') id: string,
    @Body() body: Record<string, string>,
  ): Promise<{ updated: string[] }> {
    if (!body || typeof body !== 'object') {
      throw new NotFoundException('Body deve ser um objeto { key: value }.');
    }
    await this.credentialsService.setAll(id, body);
    return { updated: Object.keys(body) };
  }

  /**
   * Atualiza uma credencial individual (rotação de chave).
   */
  @Patch(':id/credentials/:key')
  async setOne(
    @Param('id') id: string,
    @Param('key') key: string,
    @Body() body: { value: string },
  ): Promise<{ updated: string }> {
    if (!body?.value) {
      throw new NotFoundException('Body deve conter { value: string }.');
    }
    await this.credentialsService.set(id, key, body.value);
    return { updated: key };
  }

  /**
   * Remove uma credencial.
   */
  @Delete(':id/credentials/:key')
  async unset(@Param('id') id: string, @Param('key') key: string): Promise<{ removed: string }> {
    await this.credentialsService.unset(id, key);
    return { removed: key };
  }
}
