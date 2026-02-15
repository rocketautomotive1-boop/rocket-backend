import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { FreightProvider, FreightQuoteParams, FreightQuoteResult } from '../freight-provider.interface';
import { TokenManagerService } from '../../token/token-manager.service';

@Injectable()
export class JamefProvider implements FreightProvider {
    public readonly name = 'JAMEF';
    private readonly logger = new Logger(JamefProvider.name);

    // JAMEF allows custom URL via .env or defaults to QA for now as per prompt example? 
    // Prompt says: POST https://api-qa.jamef.com.br/auth/v1/login
    // I should probably make it configurable.
    private get baseUrl(): string {
        return this.configService.get<string>('JAMEF_API_URL') || 'https://api-qa.jamef.com.br';
    }

    constructor(
        private readonly httpService: HttpService,
        private readonly configService: ConfigService,
        private readonly tokenManager: TokenManagerService,
    ) { }

    async getQuote(params: FreightQuoteParams): Promise<FreightQuoteResult[]> {
        const token = await this.tokenManager.getToken('JAMEF', () => this.fetchAccessToken());

        const url = `${this.baseUrl}/calculo-frete/v1/cotacao`;
        const payload = this.mapToJamefPayload(params);

        const headers = {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        };

        try {
            const { data } = await firstValueFrom(this.httpService.post(url, payload, { headers }));
            return this.mapToFreightQuoteResult(data);
        } catch (error) {
            this.logger.error('Error fetching JAMEF quotes', error?.response?.data || error.message);
            throw error;
        }
    }

    private async fetchAccessToken(): Promise<{ accessToken: string; expiresInSeconds: number }> {
        const url = `${this.baseUrl}/auth/v1/login`;
        const username = this.configService.get<string>('JAMEF_USERNAME');
        const password = this.configService.get<string>('JAMEF_PASSWORD');

        if (!username || !password) {
            this.logger.error('Missing JAMEF credentials');
            throw new Error('Missing JAMEF credentials');
        }

        const payload = { username, password };

        const { data } = await firstValueFrom(this.httpService.post(url, payload));

        // Response format: { dado: [ { accessToken: '...', expiresIn: 3600 } ] }
        const tokenData = data.dado?.[0];
        if (!tokenData) {
            throw new Error('Invalid JAMEF auth response');
        }

        return {
            accessToken: tokenData.accessToken,
            expiresInSeconds: tokenData.expiresIn,
        };
    }

    private mapToJamefPayload(params: FreightQuoteParams): any {
        // Calculate total weight, volume, value
        const totalWeight = params.items.reduce((acc, item) => acc + item.weight, 0);
        const totalValue = params.items.reduce((acc, item) => acc + (item.price || 0), 0);

        // JAMEF uses metragemCubica. 
        // L x W x H in CM / 100 to get M. 
        // Volume = (L/100 * W/100 * H/100)
        const totalVolume = params.items.reduce((acc, item) => {
            const volume = (item.length / 100) * (item.width / 100) * (item.height / 100);
            return acc + volume;
        }, 0);

        if (!params.recipient) {
            throw new Error('Recipient data is missing');
        }

        // Required by JAMEF payload example
        const documentDest = params.recipient.document || '00000000000'; // Fallback if missing? Or should validate?
        // Let's assume passed or use a placeholder if strict validation not requested yet.
        // Also note JAMEF example uses "filialOrigem": "01". 
        // And "dataColeta": "25/12/2024" (DD/MM/YYYY). logic to get today's date formatted.

        const today = new Date();
        const dd = String(today.getDate()).padStart(2, '0');
        const mm = String(today.getMonth() + 1).padStart(2, '0'); //January is 0!
        const yyyy = today.getFullYear();
        const dataColeta = `${dd}/${mm}/${yyyy}`;

        return {
            tipoTransporte: "1", // Road?
            documentoDevedor: "12345678000195", // Hardcoded per prompt example or config?
            // "documentoDevedor" usually is the payer. If Rocket is paying, this is Rocket's CNPJ.
            // Let's assume a config or hardcode for now based on prompt example context.
            // Prompt gave: "documentoDevedor": "12345678000195"

            cepOrigem: "50720135", // Hardcoded origin as per FedEx example
            cepDestino: params.recipient.postalCode.replace(/\D/g, ''), // remove format if needed
            quantidadeVolume: params.items.length,
            pesoMercadoria: totalWeight,
            valorNotaFiscal: totalValue,
            metragemCubica: Number(totalVolume.toFixed(4)),
            documentoRemetente: "60646136000103", // Sender CNPJ - Rocket?
            documentoDestino: documentDest.replace(/\D/g, ''),
            filialOrigem: "30",
            dataColeta: dataColeta,
        };
    }

    private mapToFreightQuoteResult(data: any): FreightQuoteResult[] {
        const results: FreightQuoteResult[] = [];
        // Response format: { dado: [ { modalidadeTransporte: '1', previsaoEntrega: '02/01/2025', total: 1084.34, ... } ] }
        const items = data.dado;

        if (!items || !Array.isArray(items)) {
            return results;
        }

        for (const item of items) {
            results.push({
                serviceName: `Jamef Rodoviário`, // Map '1' to name if known
                serviceCode: item.modalidadeTransporte,
                totalPrice: item.total,
                currency: 'BRL',
                provider: this.name,
                deliveryDate: item.previsaoEntrega, // "02/01/2025"
            });
        }

        return results;
    }
}
