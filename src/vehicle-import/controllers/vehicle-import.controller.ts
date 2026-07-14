import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { VehicleImportService } from '../services/vehicle-import.service';
import { VehicleImportBlocklistService, BlockEntryInput } from '../services/vehicle-import-blocklist.service';

@Controller('vehicle-import')
export class VehicleImportController {
  constructor(
    private readonly vehicleImportService: VehicleImportService,
    private readonly blocklistService: VehicleImportBlocklistService,
  ) {}

  /** body.skipUntilBrand (opcional): retoma a partir dessa marca, pulando as anteriores. */
  @Post('mercado-livre')
  @HttpCode(HttpStatus.OK)
  runMercadoLivreImport(@Body() body?: { skipUntilBrand?: string }) {
    return this.vehicleImportService.importFromMercadoLivre(body?.skipUntilBrand);
  }

  /** Importa só uma marca (id do value_id do ML) — útil para teste/validação em escala menor. */
  @Post('mercado-livre/brand')
  @HttpCode(HttpStatus.OK)
  async runMercadoLivreImportForBrand(@Body() body: { id: string; name: string }) {
    const upserted = await this.vehicleImportService.importBrand(body);
    return { brand: body.name, upserted };
  }

  /** Importa só marca+modelo — útil para teste/validação pontual. */
  @Post('mercado-livre/model')
  @HttpCode(HttpStatus.OK)
  async runMercadoLivreImportForModel(
    @Body() body: { brand: { id: string; name: string }; model: { id: string; name: string } },
  ) {
    const upserted = await this.vehicleImportService.importSingleModel(body.brand, body.model);
    return { brand: body.brand.name, model: body.model.name, upserted };
  }

  /**
   * Bloqueia um produto (mlVehicleId) e/ou marca (make) por erro de cadastro confirmado na ML —
   * remove imediatamente as ocorrências existentes e impede reimportação nas próximas rodadas.
   */
  @Post('blocklist')
  @HttpCode(HttpStatus.OK)
  blockEntry(@Body() body: BlockEntryInput) {
    return this.blocklistService.block(body);
  }

  @Get('blocklist')
  listBlocklist() {
    return this.blocklistService.list();
  }
}
