import { Injectable, Logger } from "@nestjs/common";
import { MlHttpClient } from "./ml-http-client";

/** Leituras de catálogo/anúncios do seller (conta default). */
const CTX = (context: string) => ({ context });

interface MercadoLivreListing {
    code: number;
    body: {
      id: string;
      title: string;
      price: number;
      available_quantity: number;
      sold_quantity: number;
      status: string;
      condition: string;
      permalink: string;
      thumbnail: string;
      date_created: string;
      last_updated: string;
      seller_custom_field: string;
    };
  }

@Injectable()
export class MercadoLivreListingAdapter {
    constructor(private readonly http: MlHttpClient) { }
    private readonly logger = new Logger(MercadoLivreListingAdapter.name);

    async getSellerId(): Promise<string | undefined> {
        try {
            const mlUser = await this.http.get<any>('/users/me', CTX('listing.me'));
            return mlUser?.id != null ? String(mlUser.id) : undefined;
        } catch {
            return undefined;
        }
    }

    /**
     * GET /users/{user_id}/items/search — paginação ML (máx. 50 por página).
     */
    async searchUserItems(params?: { offset?: number; limit?: number; order?: string; tags?: string }): Promise<any> {
        const mlUser = await this.http.get<any>('/users/me', CTX('listing.me'));
        const offset = params?.offset ?? 0;
        const limit = Math.min(50, Math.max(1, params?.limit ?? 50));
        const query: Record<string, string | number> = { offset, limit };
        if (params?.order) query.order = params.order;
        if (params?.tags?.trim()) query.tags = params.tags.trim();

        this.logger.log(`Buscando items/search user=${mlUser.id} offset=${offset} limit=${limit}`);
        return this.http.get<any>(`/users/${mlUser.id}/items/search`, CTX('searchUserItems'), query);
    }

    async getListing(): Promise<any> {
        return this.searchUserItems({ offset: 0, limit: 50 });
    }

    async getListingMultiget(): Promise<any> {
        const ids = await this.getListing() as any;
        if (!ids?.results) {
            this.logger.error(`Nenhum anúncio encontrado`);
            return [];
        }

        const results = [];

        for (let i = 0; i < ids.results.length; i += 20) {
            const idsString = ids.results.slice(i, i + 20).join(',');
            this.logger.log(`Buscando detalhes de anúncios ${idsString}`);
            const data = await this.http.get<any[]>('/items', CTX('getListingMultiget'), { ids: idsString });
            results.push(...data);
        }

        return results;
    }

    async getListingMultigetByIds(ids: string): Promise<MercadoLivreListing[]> {
        if (!ids || ids.trim() === '') {
            this.logger.warn('Nenhum ID fornecido para busca');
            return [];
        }
        this.logger.log(`Buscando detalhes de anúncios por IDs: ${ids}`);
        const data = await this.http.get<MercadoLivreListing[]>('/items', CTX('getListingMultigetByIds'), { ids });
        this.logger.log(`Anúncios encontrados: ${data.length}`);
        return data;
    }

    // Nova função para buscar status de anúncios específicos
    async getListingsStatusByProductIds(productIds: number[]): Promise<Record<number, any>> {
        try {
            // Buscar todos os títulos de produtos que têm externalId
            const productTitles = await this.getProductTitlesWithExternalId(productIds);
            
            if (!productTitles.length) {
                return {};
            }

            // Extrair externalIds únicos
            const externalIds = [...new Set(productTitles.map(pt => pt.externalId))];
            const idsString = externalIds.join(',');

            // Buscar status no Mercado Livre
            const listings = await this.getListingMultigetByIds(idsString);
            
            // Mapear resultados por productId
            const statusMap: Record<number, any> = {};
            
            productTitles.forEach(productTitle => {
                const listing = listings.find(l => l.body?.id === productTitle.externalId);
                if (listing) {
                    statusMap[productTitle.productId] = {
                        externalId: listing.body.id,
                        title: listing.body.title,
                        price: listing.body.price,
                        availableQuantity: listing.body.available_quantity,
                        soldQuantity: listing.body.sold_quantity,
                        status: listing.body.status,
                        condition: listing.body.condition,
                        permalink: listing.body.permalink,
                        thumbnail: listing.body.thumbnail,
                        dateCreated: listing.body.date_created,
                        lastUpdated: listing.body.last_updated,
                        marketplace: 'Mercado Livre'
                    };
                }
            });

            return statusMap;
        } catch (error) {
            this.logger.error('Erro ao buscar status dos anúncios:', error);
            return {};
        }
    }

    // Função auxiliar para buscar títulos com externalId
    private async getProductTitlesWithExternalId(productIds: number[]): Promise<any[]> {
        // Esta função deve ser implementada no service correspondente
        // Por enquanto, retornamos um array vazio
        return [];
    }
}