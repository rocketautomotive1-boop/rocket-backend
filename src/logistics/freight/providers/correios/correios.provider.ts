import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { FreightProvider, FreightQuoteParams, FreightQuoteResult } from '../freight-provider.interface';
import { TokenManagerService } from '../../token/token-manager.service';
import { CorreiosAuthPayload, CorreiosTokenResponse, CorreiosPriceResponse, CorreiosDeadlineResponse } from './correios.dtos';

@Injectable()
export class CorreiosProvider implements FreightProvider {
    public readonly name = 'CORREIOS';
    private readonly logger = new Logger(CorreiosProvider.name);

    private get baseUrl(): string {
        return this.configService.get<string>('CORREIOS_API_BASE_URL') || 'https://api.correios.com.br';
    }

    // Default Service Codes (can be overridden by config if needed)
    // 03220: SEDEX
    // 03298: PAC
    private readonly services = [
        { code: '03220', name: 'SEDEX' },
        { code: '03298', name: 'PAC' }
    ];

    constructor(
        private readonly httpService: HttpService,
        private readonly configService: ConfigService,
        private readonly tokenManager: TokenManagerService,
    ) { }

    async getQuote(params: FreightQuoteParams): Promise<FreightQuoteResult[]> {
        const token = await this.tokenManager.getToken('CORREIOS', () => this.fetchAccessToken());

        const results: FreightQuoteResult[] = [];

        // Parallel execution for all services
        const promises = this.services.map(async (service) => {
            try {
                const [price, deadline] = await Promise.all([
                    this.fetchPrice(token, service.code, params),
                    this.fetchDeadline(token, service.code, params)
                ]);

                if (price.msgErro || deadline.msgErro) {
                    this.logger.warn(`Correios error for ${service.name}: ${price.msgErro || deadline.msgErro}`);
                    return null;
                }

                return {
                    serviceName: `Correios ${service.name}`,
                    serviceCode: service.code,
                    totalPrice: parseFloat(price.pcFinal.replace(',', '.')),
                    currency: 'BRL',
                    provider: this.name,
                    deliveryDate: deadline.dataMaxEntrega, // Format: YYYY-MM-DD or DD-MM-YYYY? API usually returns standard date in JSON or string. 
                    // API Docs says 'dataMaxEntrega' is YYYY-MM-DD usually in new REST or DD/MM/YYYY. Let's inspect/parse if needed.
                    // Actually most REST APIs return ISO or DD/MM/YYYY. We will pass it through for now.
                    deliveryTime: parseInt(deadline.prazoEntrega, 10)
                };
            } catch (error) {
                this.logger.error(`Failed to fetch ${service.name} quote: ${error.message}`);
                return null;
            }
        });

        const quotes = await Promise.all(promises);
        return quotes.filter(q => q !== null) as FreightQuoteResult[];
    }

    private async fetchAccessToken(): Promise<{ accessToken: string; expiresInSeconds: number }> {
        const url = `${this.baseUrl}/token/v1/autentica`;
        const usuario = this.configService.get<string>('CORREIOS_USER'); // "Meu Correios" User
        const codigo = this.configService.get<string>('CORREIOS_ACCESS_CODE'); // API Access Code
        const contrato = this.configService.get<string>('CORREIOS_CONTRACT');
        const cartao = this.configService.get<string>('CORREIOS_POSTING_CARD'); // Cartão de Postagem is often required for 'numero'

        // Use Card if available, otherwise Contract (common mistake or legacy mapping)
        // For Token Generation (Autentica), 'numero' IS the Contract Number.
        // 'Cartão de Postagem' is used in the pre-posting (PLP) or price headers.
        const numeroParaToken = contrato;

        if (!usuario || !codigo || !contrato) {
            this.logger.error('Missing Correios credentials (USER, ACCESS_CODE, or CONTRACT)');
            throw new Error('Missing Correios credentials');
        }

        this.logger.debug(`[Correios] Generating Token with Contract: ${contrato.substring(0, 4)}...`);
        this.logger.debug(`[Correios] Auth User: ${usuario.substring(0, 3)}***`);

        try {
            const headers = {
                'Authorization': `Basic ${Buffer.from(`${usuario}:${codigo}`).toString('base64')}`
            };

            // Log payload for visual check
            // this.logger.debug(`[Correios] Token Payload: {"numero": "${numeroParaToken}"}`);

            const { data } = await firstValueFrom(this.httpService.post<CorreiosTokenResponse>(
                url,
                { numero: numeroParaToken },
                { headers }
            ));

            const now = new Date();
            const expires = new Date(data.expiraEm);
            const diffSeconds = Math.floor((expires.getTime() - now.getTime()) / 1000);

            return {
                accessToken: data.token,
                expiresInSeconds: diffSeconds > 0 ? diffSeconds : 3600
            };

        } catch (error) {
            const errorData = error.response?.data || error.message;
            this.logger.error(`Error fetching Correios token: ${JSON.stringify(errorData)}`);
            throw error;
        }
    }

    private async fetchPrice(token: string, serviceCode: string, params: FreightQuoteParams): Promise<CorreiosPriceResponse> {
        const url = `${this.baseUrl}/preco/v1/nacional/${serviceCode}`;

        const totalWeight = params.items.reduce((acc, item) => acc + item.weight, 0); // KG
        const psObjeto = Math.ceil(totalWeight * 1000).toString(); // Grams

        // Dimensions: Sum? Or Max? Or Package? 
        // Simple heuristic: Stack height, Max length/width.
        // Or Volume root.
        // Let's sum height, max L, max W for now (simplified box stacking)
        const maxL = Math.max(...params.items.map(i => i.length));
        const maxW = Math.max(...params.items.map(i => i.width));
        const totalH = params.items.reduce((acc, i) => acc + i.height, 0);

        const queryParams = new URLSearchParams({
            cepOrigem: '50720135', // Config or fixed?
            cepDestino: params.recipient.postalCode.replace(/\D/g, ''),
            psObjeto: psObjeto,
            tpObjeto: '1', // Box
            comprimento: Math.max(maxL, 15).toString(), // Min 15
            largura: Math.max(maxW, 10).toString(), // Min 10
            altura: Math.max(totalH, 1).toString(), // Min 1
            vlDeclarado: params.items.reduce((acc, i) => acc + i.price, 0).toFixed(2),
        });

        const headers = { 'Authorization': `Bearer ${token}` };

        const { data } = await firstValueFrom(this.httpService.get<CorreiosPriceResponse>(`${url}?${queryParams.toString()}`, { headers }));
        return data;
    }

    private async fetchDeadline(token: string, serviceCode: string, params: FreightQuoteParams): Promise<CorreiosDeadlineResponse> {
        const url = `${this.baseUrl}/prazo/v1/nacional/${serviceCode}`;

        const queryParams = new URLSearchParams({
            cepOrigem: '50720135',
            cepDestino: params.recipient.postalCode.replace(/\D/g, ''),
            dtEvento: new Date().toISOString().split('T')[0] // YYYY-MM-DD
        });

        const headers = { 'Authorization': `Bearer ${token}` };

        const { data } = await firstValueFrom(this.httpService.get<CorreiosDeadlineResponse>(`${url}?${queryParams.toString()}`, { headers }));
        return data;
    }
}
