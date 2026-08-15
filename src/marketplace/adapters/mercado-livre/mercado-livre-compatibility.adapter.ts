import { Injectable, InternalServerErrorException, Logger } from "@nestjs/common";
import { MlHttpClient } from "./ml-http-client";

/** Compatibilidades ML (conta default). Token/refresh/retry no MlHttpClient. */
const CTX = (context: string) => ({ context });

@Injectable()
export class MercadoLivreCompatibilityAdapter {
    private readonly logger = new Logger(MercadoLivreCompatibilityAdapter.name);

    constructor(private readonly http: MlHttpClient) { }

    /** DELETE via MlHttpClient (a base só tem get/post como açúcar). */
    private async del(path: string, context: string): Promise<any> {
        const res = await this.http.request<any>({ method: 'DELETE', path }, CTX(context));
        return res.data;
    }

      async getCatalogDomain(domainId: string): Promise<any> {
        try {
          this.logger.log(`Buscando domínio do catálogo ${domainId}.`);
          return await this.http.get<any>(`/catalog_domains/${domainId}`, CTX('getCatalogDomain'));
        } catch (error) {
          this.logger.error(`Erro ao buscar domínio do catálogo ${domainId}:`, error.response?.data || error.message);
          throw new InternalServerErrorException('Erro ao comunicar com a API do Mercado Livre.');
        }
      }

      async searchProductCompatibilities(payload: any, fetchAll: boolean = false): Promise<any> {
        try {
          const path = '/catalog_compatibilities/products_search/chunks';

          if (!payload.domain_id || !payload.site_id) {
            payload.site_id = 'MLB';
            payload.domain_id = 'MLB-CARS_AND_VANS';
          }

          // Se fetchAll é true, buscar todos os resultados com paginação
          if (fetchAll) {
            return await this.searchAllProductCompatibilities(payload);
          }

          // Configurar paginação padrão se não fornecida
          if (!payload.limit) {
            payload.limit = 50;
          }
          if (!payload.offset) {
            payload.offset = 0;
          }

          this.logger.log(`Buscando compatibilidades de produtos e payload: ${JSON.stringify(payload)}.`);
          return await this.http.post<any>(path, CTX('searchProductCompatibilities'), payload);
        } catch (error) {
          this.logger.error('Erro ao buscar compatibilidades de produtos:', error.response?.data || error.message);
          throw new InternalServerErrorException('Erro ao comunicar com a API do Mercado Livre.');
        }
      }

      private async searchAllProductCompatibilities(payload: any): Promise<any> {
        this.logger.log(`Iniciando busca completa de compatibilidades`);
        const path = '/catalog_compatibilities/products_search/chunks';

        try {
          // Primeiro, fazer uma requisição para descobrir o total
          const initialPayload = {
            ...payload,
            limit: 1,
            offset: 0
          };

          this.logger.log(`Buscando total de registros...`);
          const initialData = await this.http.post<any>(path, CTX('searchAllCompat.total'), initialPayload);

          const totalFromAPI = initialData.total || 0;
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

            const data = await this.http.post<any>(path, CTX(`searchAllCompat.page${page + 1}`), pagePayload);
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
          const path = `/catalog_domains/MLB-CARS_AND_VANS/attributes/${attributeId}/top_values`;
          const payload = {
            known_attributes: knownAttributes,
            site_id: "MLB",
            domain_id: "MLB-CARS_AND_VANS"
          };

          this.logger.log(`Buscando top values para atributo ${attributeId}`);
          this.logger.log(`Payload: ${JSON.stringify(payload)}`);

          return await this.http.post<any>(path, CTX('getAttributeTopValues'), payload);
        } catch (error) {
          this.logger.error(`Erro ao buscar top values para atributo ${attributeId}:`, error.response?.data || error.message);
          throw new InternalServerErrorException(`Erro ao buscar valores do atributo ${attributeId} na API do Mercado Livre.`);
        }
      }

      /**
       * Item já migrado ao modelo User Products rejeita POST /items/{id}/compatibilities
       * com 400 "This Item has User Product compatibilities. Use the corresponding User
       * Product resources." (confirmado ao vivo, item MLB7358353254 → user_product_id
       * MLBU4615173703). Sinal específico — não usar o cause genérico.
       */
      private isUserProductCompatibilitiesError(error: any): boolean {
        const msg = String(error?.response?.data?.message || '');
        return error?.response?.status === 400 && /has User Product compatibilities/i.test(msg);
      }

      /**
       * POST /items/{id}/compatibilities é ADITIVO (confirmado ao vivo contra a API:
       * chamadas sucessivas ou um único payload com N produtos apenas acrescentam,
       * nunca substituem a lista existente) e funciona para itens normais. Itens já
       * migrados ao modelo User Products REJEITAM esse endpoint (ver
       * isUserProductCompatibilitiesError) — nesse caso é preciso resolver o
       * user_product_id do item e rotear para POST /user-products/{up_id}/compatibilities,
       * que exige domain_id no corpo (fora de products/products_families) e
       * creation_source obrigatório por produto (contrato oficial ML, doc de
       * compatibilidades entre itens e produtos de autopeças).
       */
      async syncCompatibility(itemId: string, compatibilityData: any): Promise<any> {
        const siteId = compatibilityData?.site_id || 'MLB';
        const domainId = compatibilityData?.domain_id || 'MLB-CARS_AND_VANS';
        const products = Array.isArray(compatibilityData?.products)
          ? compatibilityData.products
          : Array.isArray(compatibilityData?.vehicle_ids)
            ? compatibilityData.vehicle_ids.map((id: string) => ({ id }))
            : [];

        const body: Record<string, any> = { ...compatibilityData, site_id: siteId, domain_id: domainId, products };

        this.logger.log(`Sincronizando compatibilidade item=${itemId}`);
        this.logger.log(`Payload: ${JSON.stringify(body)}`);

        try {
          const result = await this.http.post<any>(`/items/${itemId}/compatibilities`, CTX('syncCompat'), body);
          if (result?.created_compatibilities_count === 0 && products.length > 0) {
            throw new InternalServerErrorException(
              `ML aceitou a requisição mas não criou nenhuma compatibilidade (item=${itemId}).`,
            );
          }
          return result;
        } catch (error: any) {
          if (error instanceof InternalServerErrorException) throw error;

          if (this.isUserProductCompatibilitiesError(error)) {
            this.logger.warn(`Item ${itemId} é User Product — retentando via /user-products/{id}/compatibilities.`);
            return this.syncUserProductCompatibilities(itemId, domainId, products);
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

      /**
       * Resolve o user_product_id do item e cria as compatibilidades via
       * POST /user-products/{up_id}/compatibilities. creation_source: 'DEFAULT' — nosso
       * fluxo não distingue sugestão de veículo novo, então usa o valor padrão do ML.
       */
      private async syncUserProductCompatibilities(itemId: string, domainId: string, products: any[]): Promise<any> {
        const item = await this.http.get<any>(`/items/${itemId}`, CTX('resolveUserProductId'));
        const userProductId = item?.user_product_id;
        if (!userProductId) {
          throw new InternalServerErrorException(
            `Item ${itemId} sinalizou User Product mas não tem user_product_id no /items — não é possível sincronizar.`,
          );
        }

        const body = {
          domain_id: domainId,
          products: products.map((p: any) => ({ ...p, creation_source: p.creation_source || 'DEFAULT' })),
        };

        this.logger.log(`Sincronizando compatibilidade user_product=${userProductId} (item=${itemId})`);
        this.logger.log(`Payload: ${JSON.stringify(body)}`);

        try {
          const result = await this.http.post<any>(`/user-products/${userProductId}/compatibilities`, CTX('syncCompatUP'), body);
          if (result?.created_compatibilities_count === 0 && products.length > 0) {
            throw new InternalServerErrorException(
              `ML aceitou a requisição mas não criou nenhuma compatibilidade (user_product=${userProductId}).`,
            );
          }
          return result;
        } catch (error: any) {
          if (error instanceof InternalServerErrorException) throw error;
          this.logger.error(`Erro ao sincronizar compatibilidade para o user_product ${userProductId}:`, error.response?.data || error.message);
          const mlMsg = error.response?.data?.message;
          throw new InternalServerErrorException(
            mlMsg || 'Erro ao sincronizar compatibilidade (User Product) com a API do Mercado Livre.',
          );
        }
      }

      /** GET /items/{id}/compatibilities — lista atual registrada no ML. */
      async getCompatibilities(itemId: string): Promise<any[]> {
        try {
          const res = await this.http.get<any>(`/items/${itemId}/compatibilities`, CTX('getCompatibilities'));
          return Array.isArray(res?.products) ? res.products : [];
        } catch (error: any) {
          this.logger.error(`Erro ao buscar compatibilidades do item ${itemId}:`, error.response?.data || error.message);
          throw new InternalServerErrorException('Erro ao buscar compatibilidades da API do Mercado Livre.');
        }
      }

      /**
       * Remove UMA compatibilidade pelo catalog_product_id (nosso `mlVehicleId`).
       * O DELETE do ML exige o id INTERNO do registro de compatibilidade (ex.
       * "18102892218"), diferente do catalog_product_id do veículo (ex.
       * "MLB22578636") — por isso primeiro busca a lista atual para resolver o id.
       * No-op silencioso se o veículo já não está mais compatível no ML.
       */
      async removeCompatibilityFromMarketplace(itemId: string, catalogProductId: string): Promise<any> {
        const current = await this.getCompatibilities(itemId);
        const match = current.find((p: any) => p?.catalog_product_id === catalogProductId);
        if (!match?.id) {
          this.logger.warn(`Compatibilidade ${catalogProductId} não encontrada no ML para item ${itemId}; nada a remover.`);
          return { removed: false };
        }

        try {
          this.logger.log(`Removendo compatibilidade ${catalogProductId} (ml id=${match.id}) do item ${itemId}`);
          await this.del(`/items/${itemId}/compatibilities/${match.id}`, 'removeCompat');
          return { removed: true };
        } catch (error: any) {
          this.logger.error(`Erro ao remover compatibilidade ${catalogProductId} do item ${itemId}:`, error.response?.data || error.message);
          throw new InternalServerErrorException(
            error.response?.data?.message || 'Erro ao remover compatibilidade da API do Mercado Livre.',
          );
        }
      }

      /**
       * Catalog matching de PEÇA (distinto do catalog de veículos MLB-CARS_AND_VANS
       * usado no resto deste adapter). Busca candidatos de catalog_product_id por
       * marca+part_number dentro de uma categoria — usado para resolver POSITION/
       * SIDE_POSITION, que só existem herdados de um catalog_product_id de peça.
       */
      async searchCatalogProductsByPartNumber(
        brand: string,
        partNumber: string,
        categoryId: string,
      ): Promise<any[]> {
        try {
          const res = await this.http.get<any>(
            '/products/search',
            CTX('searchCatalogProductsByPartNumber'),
            { site_id: 'MLB', q: `${brand} ${partNumber}`, category: categoryId },
          );
          return Array.isArray(res?.results) ? res.results : [];
        } catch (error: any) {
          this.logger.error(
            `Erro ao buscar catalog_product_id por part_number ${partNumber}:`,
            error.response?.data || error.message,
          );
          return [];
        }
      }

      /**
       * Catalog matching de PEÇA por GTIN/EAN — usado no pré-cadastro de produto
       * (busca por código de barras). Distinto de searchCatalogProductsByPartNumber
       * (marca+part_number, usado na Fase 1 de posição): aqui a busca é por
       * product_identifier, sem precisar já ter marca/part number/categoria.
       */
      async searchCatalogProductsByGtin(ean: string): Promise<any[]> {
        try {
          const res = await this.http.get<any>(
            '/products/search',
            CTX('searchCatalogProductsByGtin'),
            { site_id: 'MLB', status: 'active', product_identifier: ean },
          );
          return Array.isArray(res?.results) ? res.results : [];
        } catch (error: any) {
          this.logger.error(
            `Erro ao buscar catalog_product_id por EAN ${ean}:`,
            error.response?.data || error.message,
          );
          return [];
        }
      }

      /** GET /products/{catalogProductId} — atributos completos do SKU de catálogo. */
      async getCatalogProduct(catalogProductId: string): Promise<any | null> {
        try {
          return await this.http.get<any>(`/products/${catalogProductId}`, CTX('getCatalogProduct'));
        } catch (error: any) {
          this.logger.warn(
            `Erro ao buscar catalog_product ${catalogProductId}: ${error.response?.data?.message || error.message}`,
          );
          return null;
        }
      }
}