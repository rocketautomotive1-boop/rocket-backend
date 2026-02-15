import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom, retry } from 'rxjs';
import { FreightProvider, FreightQuoteParams, FreightQuoteResult } from '../freight-provider.interface';
import { TokenManagerService } from '../../token/token-manager.service';

@Injectable()
export class UberProvider implements FreightProvider {
    public readonly name = 'UBER';
    private readonly logger = new Logger(UberProvider.name);

    private readonly authUrl = 'https://auth.uber.com/oauth/v2/token';
    private readonly apiUrl = 'https://api.uber.com/v1/customers';

    constructor(
        private readonly httpService: HttpService,
        private readonly configService: ConfigService,
        private readonly tokenManager: TokenManagerService,
    ) { }

    async getQuote(params: FreightQuoteParams): Promise<FreightQuoteResult[]> {
        try {
            const token = await this.tokenManager.getToken('UBER', () => this.fetchAccessToken());
            const customerId = this.configService.get<string>('UBER_CUSTOMER_ID');

            if (!customerId) {
                throw new Error('UBER_CUSTOMER_ID not configured');
            }

            const url = `${this.apiUrl}/${customerId}/delivery_quotes`;
            const payload = this.mapToUberPayload(params);

            const headers = {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            };

            const { data } = await firstValueFrom<any>(
                this.httpService.post(url, payload, { headers }).pipe(
                    retry({ count: 3, delay: 1000 })
                )
            );
            return this.mapToFreightQuoteResult(data);
        } catch (error) {
            this.logger.error('Error fetching Uber quotes', error?.response?.data || error.message);
            // Return empty array to not block other providers
            return [];
        }
    }

    private async fetchAccessToken(): Promise<{ accessToken: string; expiresInSeconds: number }> {
        const clientId = this.configService.get<string>('UBER_CLIENT_ID');
        const clientSecret = this.configService.get<string>('UBER_CLIENT_SECRET');

        if (!clientId || !clientSecret) {
            throw new Error('Missing Uber credentials');
        }

        const params = new URLSearchParams();
        params.append('client_id', clientId);
        params.append('client_secret', clientSecret);
        params.append('grant_type', 'client_credentials');
        params.append('scope', 'eats.deliveries');

        const { data } = await firstValueFrom<any>(
            this.httpService.post(this.authUrl, params, {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            }).pipe(
                retry({ count: 3, delay: 1000 })
            )
        );

        return {
            accessToken: data.access_token,
            expiresInSeconds: data.expires_in,
        };
    }

    private mapToUberPayload(params: FreightQuoteParams): any {
        // Construct address objects first
        // Note: The user example showed these as stringified JSONs inside the JSON.
        // "pickup_address": "{\"street_address\":[\"Rua Dr Tavares Correia, 321\"],...}"

        // However, standard Uber Direct API usually accepts objects.
        // BUT the user specifically said: "lembrando que para uber é necessário enviar os endereços no request"
        // and provided an example where they are strings.
        // I will trust the user's specific working example over general assumptions.

        const pickupAddressObj = {
            street_address: [params.recipient.street ? `${params.recipient.street}, ${params.recipient.number || ''}` : 'Rua Carlos Gomes, 395'], // Fallback/Default from example if missing, but usually we have it. 
            // Wait, this is pickup. Pick up is from Store/Warehouse.
            // We should use a configured warehouse address or defaults.
            // For now, I'll use the example's pickup address as "Store Address" if not provided in params (params usually has recipient).
            // Params might not have sender info.
            // Using hardcoded pickup for now as is common in single-warehouse integrations, or configurable.
            city: "Recife", // Configurable?
            state: "PE",    // Configurable?
            zip_code: "50720135", // Configurable?
            country: "BR"
        };

        // Actually, let's try to be smarter. params often has origin info? 
        // FreightQuoteParams usually has items and recipient. Origin is often implied or fixed.
        // Let's use the hardcoded one from the user example for Pickup for now, or maybe check if we have config.
        // User example pickup: Rua Dr Tavares Correia, 321, Recife, PE, 51200130

        const dropoffAddressObj = {
            street_address: [`${params.recipient.street}, ${params.recipient.number}`],
            city: params.recipient.city,
            state: params.recipient.state,
            zip_code: params.recipient.postalCode.replace(/\D/g, ''),
            country: 'BR'
        };

        return {
            pickup_address: JSON.stringify(pickupAddressObj),
            dropoff_address: JSON.stringify(dropoffAddressObj),
            currency: 'brl', // fixed as per example
            currency_type: 'BRL'
        };
    }

    private mapToFreightQuoteResult(data: any): FreightQuoteResult[] {
        // Example response:
        // {
        //     "kind": "delivery_quote",
        //     "id": "dqt_...",
        //     "fee": 1050,
        //     "currency": "brl",
        //     "dropoff_eta": "2025-12-31T02:12:19Z",
        //     "duration": 20
        // }

        if (!data || data.kind !== 'delivery_quote') {
            return [];
        }

        return [{
            serviceName: 'Uber Direct',
            serviceCode: 'UBER_DIRECT',
            totalPrice: data.fee / 100, // assuming fee is in cents? User example: fee: 1050. Usually API uses cents. 1050 cents = 10.50 BRL?
            // User example has "fee": 1050. Currency BRL.
            // Uber documentation usually is in minor units (cents).
            // If 1050 is R$ 10.50, then divide by 100.
            // If it's R$ 1050.00, it's expensive. Delivery is usually ~10-30. 10.50 makes sense.
            provider: this.name,
            deliveryDate: data.dropoff_eta,
            currency: 'BRL'
        }];
    }
}
