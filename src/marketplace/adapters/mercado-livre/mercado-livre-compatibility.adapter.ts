import { HttpService } from "@nestjs/axios";
import { Injectable, InternalServerErrorException, Logger } from "@nestjs/common";
import { MercadoLivreAuthAdapter } from "./mercado-livre-auth.adapter";
import { firstValueFrom } from "rxjs";

@Injectable()
export class MercadoLivreCompatibilityAdapter {
    private readonly marketplaceName = 'Mercado Livre';
    private readonly baseUrl = 'https://api.mercadolibre.com';
    private readonly logger = new Logger(MercadoLivreCompatibilityAdapter.name);

    constructor(
        private readonly httpService: HttpService,
        private readonly mercadoLivreAuthAdapter: MercadoLivreAuthAdapter
    ) { }

    private async getHeaders() {
        const accessToken = await this.mercadoLivreAuthAdapter.getValidToken(this.marketplaceName);
        if (!accessToken) {
          throw new InternalServerErrorException('Access Token do Mercado Livre não disponível.');  
        }
        return {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        };
      }

      async getCatalogDomain(domainId: string): Promise<any> {
        try {
          const url = `${this.baseUrl}/catalog_domains/${domainId}`;
          const headers = await this.getHeaders();
          this.logger.log(`Buscando domínio do catálogo ${domainId}: ${url}.`);
          const response = await firstValueFrom(this.httpService.get(url, headers));
          return response.data;
        } catch (error) {
          this.logger.error(`Erro ao buscar domínio do catálogo ${domainId}:`, error.response?.data || error.message);
          throw new InternalServerErrorException('Erro ao comunicar com a API do Mercado Livre.');
        }
      }

      async searchProductCompatibilities(payload: any, fetchAll: boolean = false): Promise<any> {
        try {
          const url = `${this.baseUrl}/catalog_compatibilities/products_search/chunks`;
          const headers = await this.getHeaders();

          if (!payload.domain_id || !payload.site_id) {
            payload.site_id = 'MLB';
            payload.domain_id = 'MLB-CARS_AND_VANS';
          }

          // Se fetchAll é true, buscar todos os resultados com paginação
          if (fetchAll) {
            return await this.searchAllProductCompatibilities(payload, headers);
          }

          // Configurar paginação padrão se não fornecida
          if (!payload.limit) {
            payload.limit = 50;
          }
          if (!payload.offset) {
            payload.offset = 0;
          }

          this.logger.log(`Buscando compatibilidades de produtos: ${url} e payload: ${JSON.stringify(payload)}.`);
          const response = await firstValueFrom(this.httpService.post(url, payload, headers));
          return response.data;
        } catch (error) {
          this.logger.error('Erro ao buscar compatibilidades de produtos:', error.response?.data || error.message);
          throw new InternalServerErrorException('Erro ao comunicar com a API do Mercado Livre.');
        }
      }

      private async searchAllProductCompatibilities(payload: any, headers: any): Promise<any> {
        this.logger.log(`Iniciando busca completa de compatibilidades`);
      
        try {
          // Primeiro, fazer uma requisição para descobrir o total
          const initialPayload = {
            ...payload,
            limit: 1,
            offset: 0
          };
      
          this.logger.log(`Buscando total de registros...`);
          const initialResponse = await firstValueFrom(this.httpService.post(
            `${this.baseUrl}/catalog_compatibilities/products_search/chunks`,
            initialPayload,
            headers
          ));
      
          const totalFromAPI = initialResponse.data.total || 0;
          this.logger.log(`Total de registros conforme API: ${totalFromAPI}`);
      
          if (totalFromAPI === 0) {
            this.logger.log(`Nenhum resultado encontrado`);
            return {
              results: [],
              total: 0,
              paging: {
                total: 0,
                offset: 0,
                limit: 0
              }
            };
          }
      
          // Calcular quantas páginas precisamos
          const limit = 50;
          const totalPages = Math.ceil(totalFromAPI / limit);
          this.logger.log(`Total de páginas necessárias: ${totalPages}`);
      
          const allResults = [];
          const seenIds = new Set();
      
          // Buscar cada página
          for (let page = 0; page < totalPages; page++) {
            const offset = page * limit;
            const pagePayload = {
              ...payload,
              limit,
              offset
            };
      
            this.logger.log(`Buscando página ${page + 1}/${totalPages} - offset: ${offset}, limit: ${limit}`);
            
            const response = await firstValueFrom(this.httpService.post(
              `${this.baseUrl}/catalog_compatibilities/products_search/chunks`,
              pagePayload,
              headers
            ));
      
            const data = response.data;
            const results = data.results || [];
      
            this.logger.log(`Página ${page + 1}: ${results.length} resultados obtidos`);
      
            // Adicionar apenas resultados únicos
            for (const result of results) {
              const productId = result.id;
              if (productId && !seenIds.has(productId)) {
                seenIds.add(productId);
                allResults.push(result);
              }
            }
      
            this.logger.log(`Total acumulado após página ${page + 1}: ${allResults.length}`);
      
            // Se já temos todos os resultados únicos, parar
            if (allResults.length >= totalFromAPI) {
              this.logger.log(`Todos os ${totalFromAPI} resultados únicos obtidos. Parando busca.`);
              break;
            }
      
            // Pequena pausa entre requisições
            if (page < totalPages - 1) {
              await new Promise(resolve => setTimeout(resolve, 100));
            }
          }
      
          this.logger.log(`Busca finalizada. Total de resultados únicos: ${allResults.length}`);
      
          return {
            results: allResults,
            total: allResults.length,
            paging: {
              total: allResults.length,
              offset: 0,
              limit: allResults.length
            }
          };
      
        } catch (error) {
          this.logger.error(`Erro ao buscar compatibilidades:`, error.response?.data || error.message);
          throw error;
        }
      }

      private removeDuplicates(results: any[]): any[] {
        const seen = new Set();
        const uniqueResults = [];
      
        for (const result of results) {
          // Usar o ID do produto como chave única (MLB7425850, MLB7426038, etc.)
          const productId = result.id;
          
          if (productId && !seen.has(productId)) {
            seen.add(productId);
            uniqueResults.push(result);
          } else if (!productId) {
            // Se não tem ID, usar o objeto completo como chave
            const resultKey = JSON.stringify(result);
            if (!seen.has(resultKey)) {
              seen.add(resultKey);
              uniqueResults.push(result);
            }
          }
        }
      
        this.logger.log(`Removendo duplicatas: ${results.length} -> ${uniqueResults.length} resultados únicos`);
        this.logger.log(`IDs únicos encontrados: ${Array.from(seen).slice(0, 10).join(', ')}${seen.size > 10 ? '...' : ''}`);
      
        return uniqueResults;
      }

      async getAttributeTopValues(attributeId: string, knownAttributes: any[] = []): Promise<any> {
        try {
          const url = `${this.baseUrl}/catalog_domains/MLB-CARS_AND_VANS/attributes/${attributeId}/top_values`;
          const headers = await this.getHeaders();
          
          const payload = {
            known_attributes: knownAttributes,
            site_id: "MLB",
            domain_id: "MLB-CARS_AND_VANS"
          };

          this.logger.log(headers.headers.Authorization);
          this.logger.log(`Buscando top values para atributo ${attributeId}: ${url}`);
          this.logger.log(`Payload: ${JSON.stringify(payload)}`);
          
          const response = await firstValueFrom(this.httpService.post(url, payload, headers));
          
          this.logger.log(`Top values obtidos para atributo ${attributeId}: ${response.data?.length || 0} valores`);
          return response.data;
        } catch (error) {
          this.logger.error(`Erro ao buscar top values para atributo ${attributeId}:`, error.response?.data || error.message);
          throw new InternalServerErrorException(`Erro ao buscar valores do atributo ${attributeId} na API do Mercado Livre.`);
        }
      }

      async syncCompatibility(itemId: string, compatibilityData: any): Promise<any> {
        try {
          const url = `${this.baseUrl}/items/${itemId}/compatibilities`;
          const headers = await this.getHeaders();
          
          if (!compatibilityData.site_id) {
            compatibilityData.site_id = 'MLB';
          }
          if (!compatibilityData.domain_id) {
            compatibilityData.domain_id = 'MLB-CARS_AND_VANS';
          }
          if (!compatibilityData.products && Array.isArray(compatibilityData.vehicle_ids)) {
            compatibilityData.products = compatibilityData.vehicle_ids.map((id: string) => ({ id }));
          }

          // Log do payload para debug
          this.logger.log(`Sincronizando compatibilidade para o item ${itemId}: ${url}`);
          this.logger.log(`Payload: ${JSON.stringify(compatibilityData)}`);
          
          const response = await firstValueFrom(this.httpService.post(url, compatibilityData, headers));
          
          this.logger.log(`Compatibilidade sincronizada com sucesso para o item ${itemId}`);
          this.logger.log(`Resposta da API: ${JSON.stringify(response.data)}`);
          return response.data;
        } catch (error) {
          this.logger.error(`Erro ao sincronizar compatibilidade para o item ${itemId}:`, error.response?.data || error.message);
          this.logger.error(`Status code: ${error.response?.status}`);
          this.logger.error(`Headers: ${JSON.stringify(error.response?.headers)}`);
          throw new InternalServerErrorException("Erro ao sincronizar compatibilidade com a API do Mercado Livre.");
        }
      }

      async removeCompatibilityFromMarketplace(itemId: string, compatibilityId: string): Promise<any> {
        try {
          const url = `${this.baseUrl}/items/${itemId}/compatibilities/${compatibilityId}`;
          const headers = await this.getHeaders();
          this.logger.log(`Removendo compatibilidade ${compatibilityId} do item ${itemId}: ${url}.`);
          const response = await firstValueFrom(this.httpService.delete(url, headers));
          return response.data;
        } catch (error) {
          this.logger.error(`Erro ao remover compatibilidade ${compatibilityId} do item ${itemId}:`, error.response?.data || error.message);
          throw new InternalServerErrorException("Erro ao remover compatibilidade da API do Mercado Livre.");
        }
      }
}