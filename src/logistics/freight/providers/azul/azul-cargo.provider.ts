
import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { FreightProvider, FreightQuoteParams, FreightQuoteResult } from '../freight-provider.interface';
import { TokenManagerService } from '../../token/token-manager.service';

@Injectable()
export class AzulCargoProvider implements FreightProvider {
    public readonly name = 'AZUL_CARGO';
    private readonly logger = new Logger(AzulCargoProvider.name);

    private get baseUrl(): string {
        return this.configService.get<string>('AZUL_CARGO_API_URL') || 'https://ediapi.onlineapp.com.br/toolkit/api';
    }

    constructor(
        private readonly httpService: HttpService,
        private readonly configService: ConfigService,
        private readonly tokenManager: TokenManagerService,
    ) { }

    async getQuote(params: FreightQuoteParams): Promise<FreightQuoteResult[]> {
        const token = await this.tokenManager.getToken('AZUL_CARGO', () => this.fetchAccessToken());

        const url = `${this.baseUrl}/Cotacao/Enviar`;
        const payload = this.mapToAzulPayload(params, token);

        const headers = {
            'Content-Type': 'application/json',
        };

        try {
            const { data } = await firstValueFrom(this.httpService.post(url, payload, { headers }));

            if (data.HasErrors) {
                this.logger.error(`Azul Cargo API Error: ${data.ErrorText}`);
                throw new Error(data.ErrorText || 'Azul Cargo API returned an error');
            }

            return this.mapToFreightQuoteResult(data.Value);
        } catch (error) {
            this.logger.error('Error fetching Azul Cargo quotes', error?.response?.data || error.message);
            throw error;
        }
    }

    private async fetchAccessToken(): Promise<{ accessToken: string; expiresInSeconds: number }> {
        const url = `${this.baseUrl}/Autenticacao/AutenticarUsuario`;
        const email = this.configService.get<string>('AZUL_CARGO_EMAIL');
        const senha = this.configService.get<string>('AZUL_CARGO_PASSWORD');

        if (!email || !senha) {
            this.logger.error('Missing Azul Cargo credentials');
            throw new Error('Missing Azul Cargo credentials');
        }

        const payload = { Email: email, Senha: senha };

        const { data } = await firstValueFrom(this.httpService.post(url, payload));

        if (data.HasErrors) {
            throw new Error(data.ErrorText || 'Failed to authenticate with Azul Cargo');
        }

        // Token duration isn't specified in prompt, but typically these last a while. 
        // We'll assume 2 hours (7200s) or similar if not provided, to enforce refresh eventually.
        // The prompt only shows "Value": "TOKEN". 
        // We will default to 1 hour (3600s) to be safe.
        return {
            accessToken: data.Value,
            expiresInSeconds: 3600,
        };
    }

    private mapToAzulPayload(params: FreightQuoteParams, token: string): any {
        const totalWeight = params.items.reduce((acc, item) => acc + item.weight, 0);
        const totalValue = params.items.reduce((acc, item) => acc + (item.price || 0), 0);

        // Cubed weight calculation: (L x W x H) / 6000 for each item
        const totalCubedWeight = params.items.reduce((acc, item) => {
            const cubed = (item.length * item.width * item.height) / 6000;
            return acc + cubed;
        }, 0);

        const volumeCount = params.items.length || 1;
        const cepOrigem = this.configService.get<string>('AZUL_CARGO_CEP_ORIGEM') || '88345512';

        // Clean payload: Omit null/empty fields to avoid "Object reference" errors in server-side mappers
        const payload: any = {
            Token: token,
            CEPOrigem: cepOrigem.replace(/\D/g, ''),
            CEPDestino: params.recipient.postalCode.replace(/\D/g, ''),
            PesoCubado: Number(totalCubedWeight.toFixed(2)) || 0.1,
            PesoReal: Number(totalWeight.toFixed(2)) || 0.1,
            Volume: volumeCount,
            ValorTotal: totalValue || 1,
            TaxaColeta: true,
            TipoEntrega: "DOMICILIO",
            Coleta: true,
            // Re-adding empty strings. Some legacy .NET APIs crash if keys are missing entirely.
            BaseOrigem: "",
            BaseDestino: "",
            Pedido: "",
            SiglaServico: "",
            Itens: params.items.map(item => ({
                Volume: 1,
                Peso: item.weight || 0.1,
                Altura: Math.ceil(item.height || 1),      // Integer cm
                Comprimento: Math.ceil(item.length || 1), // Integer cm
                Largura: Math.ceil(item.width || 1)       // Integer cm
            }))
        };

        this.logger.debug(`[AzulCargo] Sending Payload: ${JSON.stringify(payload)}`);

        return payload;
    }

    private mapToFreightQuoteResult(values: any[]): FreightQuoteResult[] {
        if (!values || !Array.isArray(values)) {
            return [];
        }

        const results: FreightQuoteResult[] = [];
        const today = new Date();

        for (const item of values) {
            // Calculate delivery date based on today + Prazo (days)
            const deliveryDate = new Date(today);
            deliveryDate.setDate(today.getDate() + (item.Prazo || 0));
            // Format as YYYY-MM-DD or whatever usage requires. 
            // Jamef returned 'DD/MM/YYYY'. Interface says string. 
            // Let's use ISO string or local date string. 
            // Checking Jamef again: it returned exactly what API gave: "02/01/2025".
            // I'll format as DD/MM/YYYY to match Jamef's behavior for consistency if possible, 
            // or just use ISO.

            const dd = String(deliveryDate.getDate()).padStart(2, '0');
            const mm = String(deliveryDate.getMonth() + 1).padStart(2, '0');
            const yyyy = deliveryDate.getFullYear();
            const dateStr = `${dd}/${mm}/${yyyy}`;

            results.push({
                serviceName: `Azul Cargo ${item.NomeServico}`,
                serviceCode: item.NomeServico,
                totalPrice: item.Total,
                currency: 'BRL',
                provider: this.name,
                deliveryDate: dateStr,
            });
        }

        return results;
    }
}
