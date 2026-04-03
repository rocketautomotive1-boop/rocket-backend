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

    private logMlResponse(operation: string, url: string, status: number | undefined, data: unknown): void {
        const raw =
            typeof data === 'object' && data !== null ? JSON.stringify(data) : String(data ?? '');
        const body = raw.length > 12000 ? `${raw.slice(0, 12000)}…[truncated]` : raw;
        this.logger.log(`[ML API resposta] ${operation} ${url} status=${status ?? 'n/a'} body=${body}`);
    }

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

    /** Itens no modelo User Product exigem compatibilidades em `/user-products/{id}/compatibilities`. */
    private extractUserProductId(item: any): string | undefined {
        if (!item || typeof item !== 'object') return undefined;
        const v = item.user_product_id ?? item.user_product?.id;
        if (v == null || v === '') return undefined;
        return String(v);
    }

    private async fetchMlItem(itemId: string, headers: { headers: Record<string, string> }): Promise<any> {
        const res = await firstValueFrom(
            this.httpService.get(`${this.baseUrl}/items/${itemId}`, headers),
        );
        return res.data;
    }

      async getCatalogDomain(domainId: string): Promise<any> {
        try {
          const url = `${this.baseUrl}/catalog_domains/${domainId}`;
          const headers = await this.getHeaders();
          this.logger.log(`Buscando domínio do catálogo ${domainId}: ${url}.`);
          const response = await firstValueFrom(this.httpService.get(url, headers));
          this.logMlResponse('GET catalog_domains', url, response.status, response.data);
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
          this.logMlResponse('POST products_search/chunks', url, response.status, response.data);
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
          const initialUrl = `${this.baseUrl}/catalog_compatibilities/products_search/chunks`;
          const initialResponse = await firstValueFrom(this.httpService.post(
            initialUrl,
            initialPayload,
            headers
          ));
          this.logMlResponse('POST products_search/chunks (total)', initialUrl, initialResponse.status, initialResponse.data);
      
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
            
            const pageUrl = `${this.baseUrl}/catalog_compatibilities/products_search/chunks`;
            const response = await firstValueFrom(this.httpService.post(
              pageUrl,
              pagePayload,
              headers
            ));
            this.logMlResponse(`POST products_search/chunks (página ${page + 1})`, pageUrl, response.status, response.data);
      
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

          this.logger.log(`Buscando top values para atributo ${attributeId}: ${url}`);
          this.logger.log(`Payload: ${JSON.stringify(payload)}`);
          
          const response = await firstValueFrom(this.httpService.post(url, payload, headers));
          this.logMlResponse(`POST top_values ${attributeId}`, url, response.status, response.data);
          return response.data;
        } catch (error) {
          this.logger.error(`Erro ao buscar top values para atributo ${attributeId}:`, error.response?.data || error.message);
          throw new InternalServerErrorException(`Erro ao buscar valores do atributo ${attributeId} na API do Mercado Livre.`);
        }
      }

      async syncCompatibility(itemId: string, compatibilityData: any): Promise<any> {
        const headers = await this.getHeaders();
        const body: Record<string, any> = {
          ...compatibilityData,
          site_id: compatibilityData?.site_id || 'MLB',
          domain_id: compatibilityData?.domain_id || 'MLB-CARS_AND_VANS',
        };
        if (!body.products && Array.isArray(compatibilityData?.vehicle_ids)) {
          body.products = compatibilityData.vehicle_ids.map((id: string) => ({ id }));
        }

        let userProductId: string | undefined;
        try {
          const itemData = await this.fetchMlItem(itemId, headers);
          userProductId = this.extractUserProductId(itemData);
          if (userProductId) {
            this.logger.log(`Item ${itemId} usa User Product user_product_id=${userProductId}`);
          }
        } catch (e: any) {
          this.logger.warn(`GET /items/${itemId} antes do sync de compat falhou: ${e?.message}`);
        }

        const postCompat = async (url: string, label: string) => {
          this.logger.log(`Sincronizando compatibilidade (${label}) item=${itemId}: ${url}`);
          this.logger.log(`Payload: ${JSON.stringify(body)}`);
          const response = await firstValueFrom(this.httpService.post(url, body, headers));
          this.logMlResponse(`POST ${label}`, url, response.status, response.data);
          return response.data;
        };

        try {
          if (userProductId) {
            const url = `${this.baseUrl}/user-products/${userProductId}/compatibilities`;
            return await postCompat(url, 'user-products/.../compatibilities');
          }
          const urlItems = `${this.baseUrl}/items/${itemId}/compatibilities`;
          return await postCompat(urlItems, 'items/.../compatibilities');
        } catch (error: any) {
          const msg = String(error.response?.data?.message || '');
          const isUserProductMigrationError =
            error.response?.status === 400 &&
            (msg.includes('User Product') || msg.includes('user product'));

          if (isUserProductMigrationError && !userProductId) {
            try {
              const itemData = await this.fetchMlItem(itemId, headers);
              const up = this.extractUserProductId(itemData);
              if (up) {
                this.logger.warn(
                  `Retry: ML recusou /items/.../compat; usando User Product user_product_id=${up}`,
                );
                const url = `${this.baseUrl}/user-products/${up}/compatibilities`;
                return await postCompat(url, 'user-products/.../compatibilities(retry)');
              }
            } catch (retryErr: any) {
              this.logger.error(`Retry User Product falhou: ${retryErr?.message}`);
            }
          }

          this.logger.error(`Erro ao sincronizar compatibilidade para o item ${itemId}:`, error.response?.data || error.message);
          if (error.response?.status) {
            this.logger.error(`Status code: ${error.response.status}`);
          }
          const mlMsg = error.response?.data?.message;
          throw new InternalServerErrorException(
            mlMsg || 'Erro ao sincronizar compatibilidade com a API do Mercado Livre.',
          );
        }
      }

      async removeCompatibilityFromMarketplace(itemId: string, compatibilityId: string): Promise<any> {
        const headers = await this.getHeaders();
        let userProductId: string | undefined;
        try {
          const itemData = await this.fetchMlItem(itemId, headers);
          userProductId = this.extractUserProductId(itemData);
        } catch {
          // fallback para URL legacy
        }

        const doDelete = async (url: string, label: string) => {
          this.logger.log(`Removendo compatibilidade ${compatibilityId} (${label}) ${url}`);
          const response = await firstValueFrom(this.httpService.delete(url, headers));
          this.logMlResponse(`DELETE ${label}`, url, response.status, response.data);
          return response.data;
        };

        try {
          if (userProductId) {
            const url = `${this.baseUrl}/user-products/${userProductId}/compatibilities/${compatibilityId}`;
            return await doDelete(url, 'user-products');
          }
          const url = `${this.baseUrl}/items/${itemId}/compatibilities/${compatibilityId}`;
          return await doDelete(url, 'items');
        } catch (error: any) {
          const msg = String(error.response?.data?.message || '');
          const retryUp =
            error.response?.status === 400 &&
            (msg.includes('User Product') || msg.includes('user product')) &&
            !userProductId;
          if (retryUp) {
            try {
              const itemData = await this.fetchMlItem(itemId, headers);
              const up = this.extractUserProductId(itemData);
              if (up) {
                const url = `${this.baseUrl}/user-products/${up}/compatibilities/${compatibilityId}`;
                return await doDelete(url, 'user-products(retry)');
              }
            } catch {
              /* fall through */
            }
          }
          this.logger.error(`Erro ao remover compatibilidade ${compatibilityId} do item ${itemId}:`, error.response?.data || error.message);
          throw new InternalServerErrorException(
            error.response?.data?.message || 'Erro ao remover compatibilidade da API do Mercado Livre.',
          );
        }
      }
}