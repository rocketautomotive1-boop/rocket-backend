import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { MercadoLivreAuthAdapter } from '../marketplace/adapters/mercado-livre/mercado-livre-auth.adapter';
import { GetCompatibilityFiltersDto } from './dto/get-compatibility-filters.dto';
import { ProductCompatibilityService } from 'src/product/services/product-compatibility.service';
import { ProductTitleService } from 'src/product/services/product-title.service';

interface KnownAttribute {
  id: string;
  value_ids: string[];
}

export interface CatalogSearchRequest {
  domain_id: string;
  site_id: string;
  known_attributes: KnownAttribute[];
  limit?: number;
  offset?: number;
}

export interface TopValuesResponse {
  values: Array<{
    id: string;
    name: string;
  }>;
}

export interface SmartSearchResult {
  strategy: 'top_values' | 'chunks';
  results?: any[];
  filter_values?: TopValuesResponse;
  next_filter?: string;
}

@Injectable()
export class CompatibilityService {
  private readonly logger = new Logger(CompatibilityService.name);
  private readonly baseUrl = 'https://api.mercadolibre.com';
  private readonly marketplaceName = 'Mercado Livre';

  constructor(
    private readonly httpService: HttpService,
    private readonly mercadoLivreAuth: MercadoLivreAuthAdapter,
    private readonly productCompatibilityService: ProductCompatibilityService,
    private readonly productTitleService: ProductTitleService
  ) { }

  // Método principal para estratégia híbrida
  async smartSearch(searchRequest: CatalogSearchRequest): Promise<SmartSearchResult> {
    this.logger.log('🔍 Iniciando busca usando top_values para todos os filtros');

    const knownAttrs = this.convertKnownAttributesToObject(searchRequest.known_attributes);
    const filterCount = Object.keys(knownAttrs).length;

    this.logger.log(`�� Filtros conhecidos: ${filterCount}`, knownAttrs);

    // Determinar próximo filtro baseado nos filtros já selecionados
    const nextFilter = this.determineNextFilter(knownAttrs);

    if (!nextFilter) {
      this.logger.log('✅ Todos os filtros foram preenchidos');
      return {
        strategy: 'top_values',
        next_filter: null
      };
    }

    this.logger.log(`🎯 Buscando valores para próximo filtro: ${nextFilter}`);
    const filterValues = await this.getTopValues(nextFilter, knownAttrs);

    return {
      strategy: 'top_values',
      filter_values: filterValues,
      next_filter: nextFilter
    };
  }

  // Método para buscar top_values (BRAND, MODEL, etc.)
  async getTopValues(attributeId: string, knownAttributes: Record<string, string[]> = {}): Promise<TopValuesResponse> {
    this.logger.log(`🔍 Buscando top_values para ${attributeId}`);
    this.logger.log('📋 Known attributes:', knownAttributes);

    try {
      const accessToken = await this.mercadoLivreAuth.getValidToken(this.marketplaceName);
      const url = `https://api.mercadolibre.com/catalog_domains/MLB-CARS_AND_VANS/attributes/${attributeId}/top_values`;

      let requestBody = {};
      let headers = {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
      };

      // Se temos filtros conhecidos, incluí-los na requisição
      if (Object.keys(knownAttributes).length > 0) {
        const knownAttributesFormatted = [];

        // Converter todos os filtros conhecidos para o formato da API
        Object.entries(knownAttributes).forEach(([attrId, valueIds]) => {
          valueIds.forEach(valueId => {
            knownAttributesFormatted.push({
              id: attrId,
              value_id: valueId
            });
          });
        });

        requestBody = {
          known_attributes: knownAttributesFormatted
        };

        headers['Content-Type'] = 'application/json';

        this.logger.log(`📡 Chamando API ML para ${attributeId} com filtros:`, url);
        this.logger.log('📋 Body:', JSON.stringify(requestBody, null, 2));
      } else {
        this.logger.log(`📡 Chamando API ML para ${attributeId} sem filtros:`, url);
      }

      const response = await firstValueFrom(
        this.httpService.post(url, requestBody, { headers })
      );

      // Normalizar resposta (alguns endpoints retornam dados diretamente, outros em .values)
      const values = response.data;

      this.logger.log(`✅ ${attributeId}: ${values.length} valores encontrados`);

      return {
        values: values
      };

    } catch (error) {
      this.logger.error(`❌ Erro ao buscar top_values para ${attributeId}:`, error);

      if (error.response) {
        this.logger.error('📄 Detalhes do erro:', {
          status: error.response.status,
          data: error.response.data,
          url: error.config?.url
        });
      }

      // Em caso de erro, retornar array vazio ao invés de falhar
      this.logger.warn(`⚠️ Retornando array vazio para ${attributeId} devido ao erro`);
      return {
        values: []
      };
    }
  }

  // Método existente para chunks (mantido para filtros específicos)
  async searchProductsChunks(searchRequest: CatalogSearchRequest): Promise<any> {
    this.logger.log('📦 Iniciando busca via chunks');

    try {
      const accessToken = await this.mercadoLivreAuth.getValidToken(this.marketplaceName);
      const url = 'https://api.mercadolibre.com/catalog_compatibilities/products_search/chunks';

      const headers = {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      };

      const requestBody = {
        domain_id: searchRequest.domain_id,
        site_id: searchRequest.site_id,
        known_attributes: searchRequest.known_attributes,
        limit: searchRequest.limit || 50,
        offset: searchRequest.offset || 0,
      };

      this.logger.log('📡 Chamando API chunks:', url);
      this.logger.log('📋 Body:', JSON.stringify(requestBody, null, 2));

      const response = await firstValueFrom(
        this.httpService.post(url, requestBody, { headers })
      );

      this.logger.log(`✅ Chunks: ${response.data.results?.length || 0} resultados encontrados`);
      return response.data;

    } catch (error) {
      this.logger.error('❌ Erro na busca via chunks:', error);
      throw error;
    }
  }

  // Método para compatibilidade com endpoint antigo
  async getCompatibilityFilters(knownAttributes: any = {}): Promise<any> {
    this.logger.log('�� Método legado: getCompatibilityFilters usando top_values');

    // Converter para novo formato e usar smart search
    const searchRequest: CatalogSearchRequest = {
      domain_id: 'MLB-CARS_AND_VANS',
      site_id: 'MLB',
      known_attributes: Object.entries(knownAttributes).map(([id, values]) => ({
        id,
        value_ids: Array.isArray(values) ? values : [values]
      })),
      limit: 50,
      offset: 0
    };

    const result = await this.smartSearch(searchRequest);

    // Retornar no formato esperado pelo frontend
    return {
      filterId: result.next_filter,
      values: result.filter_values?.values || []
    };
  }

  async searchVehicles(knownAttributes: Record<string, string[]> = {}): Promise<any> {
    this.logger.log('🚗 Iniciando busca final de veículos usando top_values');

    try {
      const accessToken = await this.mercadoLivreAuth.getValidToken(this.marketplaceName);
      const url = 'https://api.mercadolibre.com/catalog_compatibilities/products_search';

      // Converter filtros para formato da API
      const knownAttributesFormatted = [];
      Object.entries(knownAttributes).forEach(([attrId, valueIds]) => {
        valueIds.forEach(valueId => {
          knownAttributesFormatted.push({
            id: attrId,
            value_id: valueId
          });
        });
      });

      const requestBody = {
        domain_id: 'MLB-CARS_AND_VANS',
        site_id: 'MLB',
        known_attributes: knownAttributesFormatted,
        limit: 100, // Limite maior para buscar mais veículos
        offset: 0
      };

      const headers = {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      };

      this.logger.log('📡 Chamando API de busca final de veículos:', url);
      this.logger.log('📋 Body:', JSON.stringify(requestBody, null, 2));

      const response = await firstValueFrom(
        this.httpService.post(url, requestBody, { headers })
      );

      this.logger.log(`✅ Veículos encontrados: ${response.data.results?.length || 0}`);
      return response.data;

    } catch (error) {
      this.logger.error('❌ Erro na busca final de veículos:', error);
      throw error;
    }
  }

  // Métodos auxiliares
  private convertKnownAttributesToObject(knownAttributes: KnownAttribute[]): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    knownAttributes.forEach(attr => {
      result[attr.id] = attr.value_ids;
    });
    return result;
  }

  private determineNextFilter(knownAttributes: Record<string, string[]>): string | null {
    const filterOrder = ['BRAND', 'MODEL', 'VEHICLE_YEAR', 'TRIM', 'ENGINE', 'FUEL_TYPE', 'TRANSMISSION'];

    for (const filterId of filterOrder) {
      if (!knownAttributes[filterId] || knownAttributes[filterId].length === 0) {
        return filterId;
      }
    }

    return null; // Todos os filtros preenchidos
  }

  private extractNextFilterFromResults(results: any[], knownAttributes: any): any {
    const nextFilter = this.determineNextFilter(knownAttributes);

    if (!nextFilter || !results || results.length === 0) {
      return { filterId: null, values: [] };
    }

    // Extrair valores únicos do próximo filtro
    const uniqueValues = new Map();

    results.forEach(result => {
      const attr = result.attributes?.find(a => a.id === nextFilter);
      if (attr && attr.value_id && attr.value_name) {
        uniqueValues.set(attr.value_id, {
          id: attr.value_id,
          name: attr.value_name
        });
      }
    });

    const values = Array.from(uniqueValues.values())
      .sort((a, b) => a.name.localeCompare(b.name));

    this.logger.log(`📊 Extraídos ${values.length} valores únicos para ${nextFilter}`);

    return {
      filterId: nextFilter,
      values: values
    };
  }

  async addVehicleCompatibility(titleId: string, vehicleIds: string[], vehicleDetails?: any[]): Promise<any> {
    try {
      this.logger.log(` Adicionando compatibilidade para título ${titleId} com ${vehicleIds.length} veículos`);

      const token = await this.mercadoLivreAuth.getValidToken(this.marketplaceName);
      const headers = {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      };

      const endpointUrl = `${this.baseUrl}/items/${titleId}/compatibilities`;
      const requestBody = {
        products: vehicleIds.map(id => ({ id }))
      };

      this.logger.log(`📡 Chamando endpoint POST: ${endpointUrl}`);
      this.logger.log(` Body da requisição: ${JSON.stringify(requestBody)}`);

      const response = await firstValueFrom(
        this.httpService.post(endpointUrl, requestBody, { headers })
      );

      this.logger.log(`✅ Compatibilidade adicionada com sucesso para título ${titleId} no Mercado Livre`);

      // Buscar o ProductTitle pelo externalId para obter o productId
      try {
        this.logger.log(`🔍 Buscando ProductTitle pelo externalId: ${titleId}`);
        const productTitle = await this.productTitleService.findByExternalId(titleId);

        if (productTitle && (productTitle as any).product?.id) {
          const ptId = (productTitle as any).id || (productTitle as any)._id;
          const productId = (productTitle as any).product.id;
          this.logger.log(`✅ ProductTitle encontrado: ID ${ptId} para externalId ${titleId}`);
          this.logger.log(`📋 Detalhes do ProductTitle:`, {
            id: ptId,
            title: (productTitle as any).title,
            productId: productId,
            marketplaceId: (productTitle as any).marketplaceId
          });

          // Salvar no banco de dados local usando apenas productId
          this.logger.log(` Salvando ${vehicleIds.length} compatibilidades no banco de dados usando BATCH...`);

          let savedCompatibilities;
          if (vehicleIds.length > 1000) {
            // Para grandes volumes, usar chunking
            savedCompatibilities = await this.productCompatibilityService.createMultipleCompatibilitiesBatchChunked({
              productId: productId, // Apenas productId
              vehicleIds,
              vehicleDetails,
            });
          } else {
            // Para volumes menores, usar batch simples
            savedCompatibilities = await this.productCompatibilityService.createMultipleCompatibilitiesBatch({
              productId: productId, // Apenas productId
              vehicleIds,
              vehicleDetails,
            });
          }

          this.logger.log(`✅ ${savedCompatibilities.length} compatibilidades salvas no banco de dados local usando BATCH`);
          this.logger.log(`📊 Detalhes: ProductId=${productId}`);
        } else {
          this.logger.warn(`⚠️ ProductTitle não encontrado ou sem product associado para externalId ${titleId}`);
          this.logger.warn(`📋 Isso pode acontecer se o título não foi sincronizado com o banco de dados local`);
        }
      } catch (dbError) {
        this.logger.error('❌ Erro ao salvar no banco de dados local:', dbError);
        this.logger.error('📋 Stack trace:', dbError.stack);
        // Não falhar a operação se o salvamento local falhar
      }

      return response.data;

    } catch (error) {
      this.logger.error('❌ Erro ao adicionar compatibilidade de veículos:', error.response?.data || error.message);
      this.logger.error(` URL da Requisição: ${error.config?.url}`);
      this.logger.error(` Body da Requisição: ${JSON.stringify(error.config?.data)}`);
      throw error;
    }
  }
}