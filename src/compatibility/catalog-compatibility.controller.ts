import { 
  Controller, 
  Get, 
  Post, 
  Body, 
  Param,
  Query,
  HttpException, 
  HttpStatus, 
  Logger,
  ValidationPipe,
  UsePipes
} from '@nestjs/common';
import { CompatibilityService } from './compatibility.service';
import { CatalogCompatibilitySearchDto } from './dto/catalog-compatibility-search.dto';

@Controller('catalog_domains/MLB-CARS_AND_VANS/attributes')
export class CatalogDomainsController {
  private readonly logger = new Logger(CatalogDomainsController.name);

  constructor(private readonly compatibilityService: CompatibilityService) {}

  @Get(':attributeId/top_values')
  async getTopValues(
    @Param('attributeId') attributeId: string,
    @Query('known_attributes') knownAttributes?: string
  ) {
    this.logger.log(`🔍 Buscando top_values para atributo: ${attributeId}`);
    
    try {
      // Validar atributo suportado
      const supportedAttributes = ['BRAND', 'MODEL', 'VEHICLE_YEAR', 'VERSION', 'ENGINE', 'FUEL_TYPE', 'TRANSMISSION'];
      if (!supportedAttributes.includes(attributeId)) {
        throw new HttpException(
          `Atributo não suportado: ${attributeId}. Suportados: ${supportedAttributes.join(', ')}`,
          HttpStatus.BAD_REQUEST
        );
      }

      // Parse known_attributes se fornecido
      let parsedKnownAttributes = {};
      if (knownAttributes) {
        try {
          parsedKnownAttributes = JSON.parse(knownAttributes);
          this.logger.log('🔍 Known attributes recebidos:', parsedKnownAttributes);
        } catch (error) {
          this.logger.warn('⚠️ Erro ao fazer parse de known_attributes, ignorando:', error.message);
        }
      }

      // Chamar serviço
      const result = await this.compatibilityService.getTopValues(attributeId, parsedKnownAttributes);
      
      this.logger.log(`✅ Retornando ${result.values?.length || 0} valores para ${attributeId}`);
      return result;

    } catch (error) {
      this.logger.error(`💥 Erro ao buscar top_values para ${attributeId}:`, error);
      
      if (error instanceof HttpException) {
        throw error;
      }
      
      throw new HttpException(
        `Erro interno ao buscar valores para ${attributeId}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}

// Controller existente atualizado para estratégia híbrida
@Controller('catalog_compatibilities')
export class CatalogCompatibilityController {
  private readonly logger = new Logger(CatalogCompatibilityController.name);

  constructor(private readonly compatibilityService: CompatibilityService) {}

  @Post('products_search/chunks')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async searchProductsChunks(@Body() searchDto: CatalogCompatibilitySearchDto) {
    this.logger.log('🚀 Recebendo requisição POST /catalog_compatibilities/products_search/chunks');
    this.logger.log('📋 Body da requisição:', JSON.stringify(searchDto, null, 2));

    try {
      // Validações específicas
      if (!searchDto.isValidVehicleRequest()) {
        this.logger.warn('❌ Requisição inválida: domain_id ou site_id incorretos');
        throw new HttpException(
          'Esta API suporta apenas domain_id=MLB-CARS_AND_VANS e site_id=MLB',
          HttpStatus.BAD_REQUEST
        );
      }

      if (!searchDto.known_attributes || searchDto.known_attributes.length === 0) {
        this.logger.warn('❌ Requisição inválida: known_attributes vazio');
        throw new HttpException(
          'known_attributes deve conter pelo menos um atributo',
          HttpStatus.BAD_REQUEST
        );
      }

      // Verificar se deve usar top_values ou chunks
      const knownAttrs = searchDto.getKnownAttributesAsObject();
      const hasOnlyBrandOrModel = Object.keys(knownAttrs).every(key => ['BRAND', 'MODEL'].includes(key));
      
      if (hasOnlyBrandOrModel && Object.keys(knownAttrs).length === 1) {
        this.logger.log('🔄 Redirecionando para estratégia top_values (apenas BRAND ou MODEL)');
        
        // Para BRAND ou MODEL isolados, usar top_values é melhor
        const attributeId = Object.keys(knownAttrs)[0];
        const nextAttribute = attributeId === 'BRAND' ? 'MODEL' : 'VEHICLE_YEAR';
        
        const result = await this.compatibilityService.getTopValues(nextAttribute, knownAttrs);
        
        // Converter para formato compatível com chunks
        return {
          results: [], // Não retorna veículos, apenas valores do próximo filtro
          extracted_filter: result,
          strategy: 'top_values'
        };
      }

      // Para filtros mais complexos, usar chunks
      this.logger.log('📡 Usando estratégia chunks para filtros complexos');
      const result = await this.compatibilityService.searchProductsChunks(searchDto);
      
      this.logger.log(`✅ Retornando ${result.results?.length || 0} resultados via chunks`);
      return {
        ...result,
        strategy: 'chunks'
      };

    } catch (error) {
      this.logger.error('💥 Erro ao buscar produtos:', error);
      
      if (error instanceof HttpException) {
        throw error;
      }
      
      throw new HttpException(
        'Erro interno do servidor ao buscar produtos',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  // Endpoint para estratégia híbrida inteligente
  @Post('smart_search')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async smartSearch(@Body() searchDto: CatalogCompatibilitySearchDto) {
    this.logger.log('🧠 Recebendo requisição POST /catalog_compatibilities/smart_search');
    
    try {
      const result = await this.compatibilityService.smartSearch(searchDto);
      this.logger.log(`✅ Smart search concluída com estratégia: ${result.strategy}`);
      return result;
      
    } catch (error) {
      this.logger.error('💥 Erro no smart search:', error);
      throw error;
    }
  }
}