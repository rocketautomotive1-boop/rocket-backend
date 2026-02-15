import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { FreightProvider, FreightQuoteParams, FreightQuoteResult } from '../freight-provider.interface';
import { TokenManagerService } from '../../token/token-manager.service';

@Injectable()
export class FedExProvider implements FreightProvider {
    public readonly name = 'FEDEX';
    private readonly logger = new Logger(FedExProvider.name);
    private get baseUrl(): string {
        return this.configService.get<string>('FEDEX_API_URL') || 'https://apis.fedex.com';
    }

    constructor(
        private readonly httpService: HttpService,
        private readonly configService: ConfigService,
        private readonly tokenManager: TokenManagerService,
    ) { }

    private get clientId(): string {
        return this.configService.get<string>('FEDEX_CLIENT_ID');
    }

    private get clientSecret(): string {
        return this.configService.get<string>('FEDEX_CLIENT_SECRET');
    }

    private get accountNumber(): string {
        return this.configService.get<string>('FEDEX_ACCOUNT_NUMBER');
    }

    async getQuote(params: FreightQuoteParams): Promise<FreightQuoteResult[]> {
        const token = await this.tokenManager.getToken('FEDEX', () => this.fetchAccessToken());

        const url = `${this.baseUrl}/rate/v1/rates/quotes`;
        const payload = this.mapToFedExPayload(params);

        const headers = {
            'Content-Type': 'application/json',
            'X-locale': 'pt_BR',
            'Authorization': `Bearer ${token}`,
        };

        try {
            const { data } = await firstValueFrom(this.httpService.post(url, payload, { headers }));
            return this.mapToFreightQuoteResult(data);
        } catch (error) {
            this.logger.error('Error fetching FedEx quotes', error?.response?.data || error.message);
            // In a real scenario, we might want to return empty array or throw, depending on if we want partial failures.
            // For now, let's throw to be explicit.
            throw error;
        }
    }

    private async fetchAccessToken(): Promise<{ accessToken: string; expiresInSeconds: number }> {
        const url = `${this.baseUrl}/oauth/token`;
        this.logger.debug(`Fetching FedEx token from: ${url}`);

        const clientId = this.clientId;
        const clientSecret = this.clientSecret;

        if (!clientId || !clientSecret) {
            this.logger.error(`Missing FedEx credentials. ClientID: ${clientId ? 'SET' : 'MISSING'}, Secret: ${clientSecret ? 'SET' : 'MISSING'}`);
        } else {
            this.logger.debug(`FedEx Credentials - ClientID starts with: ${clientId.substring(0, 4)}***`);
        }

        const params = new URLSearchParams();
        params.append('grant_type', 'client_credentials');
        params.append('client_id', clientId);
        params.append('client_secret', clientSecret);

        try {
            const { data } = await firstValueFrom(
                this.httpService.post(url, params.toString(), {
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                }),
            );

            return {
                accessToken: data.access_token,
                expiresInSeconds: data.expires_in,
            };
        } catch (error) {
            this.logger.error(`FedEx Token Fetch Failed: ${error.message}`, error?.response?.data);
            throw error;
        }
    }

    private mapToFedExPayload(params: FreightQuoteParams): any {
        // According to user request:
        // "pickupType": "DROPOFF_AT_FEDEX_LOCATION"
        // "requestedPackageLineItems": logic to sum up or add multiple items.
        // For simplicity and typical FedEx API usage, we'll map each item.

        if (!params.recipient) {
            throw new Error('Recipient data is missing');
        }

        return {
            accountNumber: {
                value: this.accountNumber,
            },
            requestedShipment: {
                shipper: {
                    address: {
                        countryCode: 'BR',
                        postalCode: '50720135', // Origin Hardcoded as per user example (likely their warehouse)
                    },
                },
                recipient: {
                    address: {
                        countryCode: params.recipient.countryCode || 'BR',
                        postalCode: params.recipient.postalCode,
                    },
                },
                pickupType: 'DROPOFF_AT_FEDEX_LOCATION',
                requestedPackageLineItems: params.items.map(item => ({
                    weight: {
                        units: 'KG',
                        value: item.weight.toString(),
                    },
                    dimensions: {
                        length: Math.round(item.length),
                        width: Math.round(item.width),
                        height: Math.round(item.height),
                        units: 'CM',
                    },
                })),
                rateRequestType: ['ACCOUNT'], // Use ACCOUNT rates as per example usually or explicit list
                // The user example had empty rateRequestType [], let's stick to what works generally or leave empty if example had it.
                // Example had: "rateRequestType": []
            },
        };
    }

    private mapToFreightQuoteResult(data: any): FreightQuoteResult[] {
        const results: FreightQuoteResult[] = [];
        const rateReplyDetails = data?.output?.rateReplyDetails;

        if (!rateReplyDetails || !Array.isArray(rateReplyDetails)) {
            return results;
        }

        for (const detail of rateReplyDetails) {
            // Find the shipmentRateDetail (usually one per service)
            const ratedShipment = detail.ratedShipmentDetails?.find(r => r.totalNetCharge);

            if (ratedShipment) {
                results.push({
                    serviceName: detail.serviceName,
                    serviceCode: detail.serviceType,
                    provider: this.name,
                    currency: ratedShipment.currency || 'BRL',
                    totalPrice: ratedShipment.totalNetCharge,
                    // FedEx API sometimes returns commitDate or deliveryTimestamp, but keeping it simple based on the prompt's provided json response causing no complication.
                    // The prompt JSON doesn't explicitly show 'deliveryDate' in the output provided, so we leave it optional/undefined.
                });
            }
        }

        return results;
    }
}
