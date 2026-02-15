import { forwardRef, Inject, Injectable, Logger } from "@nestjs/common";
import { MercadoLivreAuthAdapter } from "./mercado-livre-auth.adapter";
import axios from "axios";

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
    constructor(
        @Inject(forwardRef(() => MercadoLivreAuthAdapter))
        private readonly authAdapter: MercadoLivreAuthAdapter,
    ) { }
    private readonly logger = new Logger(MercadoLivreListingAdapter.name);
    private baseUrl = 'https://api.mercadolibre.com';
    private name = 'Mercado Livre';

    async getListing(): Promise<any> {
        const mlUser = await this.authAdapter.me(this.name);
        const token = await this.authAdapter.getValidToken(this.name);

        try {
            this.logger.log(`Buscando lista de produtos para o usuário ${mlUser.id}`);

            const response = await axios.get(`${this.baseUrl}/users/${mlUser.id}/items/search`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                },
            });
            this.logger.log(`Lista de produtos encontrada para o usuário ${mlUser.id}`);
            return response.data;
        } catch (error) {
            this.logger.error(`Erro ao buscar lista de produtos: ${JSON.stringify(error.response?.data)}`);
            throw error;
        }
    }

    async getListingMultiget(): Promise<any> {
        const token = await this.authAdapter.getValidToken(this.name);
        const ids = await this.getListing() as any;
        if (!ids?.results) {
            this.logger.error(`Nenhum anúncio encontrado`);
            return [];
        }

        const results = [];

        for (let i = 0; i < ids.results.length; i += 20) {
            const idsArray = ids.results.slice(i, i + 20);
            const idsString = idsArray.map(item => item).join(',');

            try {
                this.logger.log(`Buscando detalhes de anúncios ${idsString}`);
                const response = await axios.get(`${this.baseUrl}/items?ids=${idsString}`, {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                    },
                });
                results.push(...response.data);
            } catch (error) {
                this.logger.error(`Erro ao buscar lista de produtos: ${JSON.stringify(error.response?.data)}`);
                throw error;
            }
        }
        
        return results;
    }

    async getListingMultigetByIds(ids: string): Promise<MercadoLivreListing[]> {
        const token = await this.authAdapter.getValidToken(this.name);

        try {
            this.logger.log(`Buscando detalhes de anúncios por IDs: ${ids}`);
            
            if (!ids || ids.trim() === '') {
                this.logger.warn('Nenhum ID fornecido para busca');
                return [];
            }

            const response = await axios.get(`${this.baseUrl}/items?ids=${ids}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                },
            });

            this.logger.log(`Anúncios encontrados: ${response.data.length}`);
            this.logger.log(`Resposta da API: ${JSON.stringify(response.data, null, 2)}`);
            
            return response.data;
        } catch (error) {
            this.logger.error(`Erro ao buscar anúncios por IDs: ${JSON.stringify(error.response?.data)}`);
            throw error;
        }
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