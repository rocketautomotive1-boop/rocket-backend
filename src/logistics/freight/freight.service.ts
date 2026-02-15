import { Injectable } from '@nestjs/common';
import { FreightProvider, FreightQuoteParams, FreightQuoteResult } from './providers/freight-provider.interface';
import { FedExProvider } from './providers/fedex/fedex.provider';
import { JamefProvider } from './providers/jamef/jamef.provider';

import { AzulCargoProvider } from './providers/azul/azul-cargo.provider';
import { CorreiosProvider } from './providers/correios/correios.provider';
import { UberProvider } from './providers/uber/uber.provider';

const CARRIER_LOGOS: Record<string, string> = {
    'FEDEX': 'https://logos-world.net/wp-content/uploads/2020/04/FedEx-Logo.png',
    'JAMEF': 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSq7tH5G3v-HjJjP4Ea-Xk7u_l6w8xYq9zKqA&s',
    'AZUL': 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3d/Azul_Linhas_Aereas_Brasileiras_logo.svg/2560px-Azul_Linhas_Aereas_Brasileiras_logo.svg.png',
    'CORREIOS': 'https://logodownload.org/wp-content/uploads/2014/05/correios-logo-0.png',
    'BRASPRESS': 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcS-v-k_MqF8dC9_qfJ00xGkF9tF70_w6_y',
    'JADLOG': 'https://seeklogo.com/images/J/jadlog-logo-02847587E4-seeklogo.com.png',
    'LOGGI': 'https://logodownload.org/wp-content/uploads/2019/08/loggi-logo.png',
    'TNT': 'https://companieslogo.com/img/orig/TNT-26e5fc50.png',
    'LATAM': 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/fe/Latam-logo_-v_%28Indigo%29.svg/2560px-Latam-logo_-v_%28Indigo%29.svg.png',
    'GOL': 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b3/Gol_Transportes_A%C3%A9reos_-_Logo.svg/2560px-Gol_Transportes_A%C3%A9reos_-_Logo.svg.png',
    'UBER': 'https://logos-world.net/wp-content/uploads/2020/05/Uber-Logo.png'
};

@Injectable()
export class FreightService {
    private providers: FreightProvider[] = [];

    constructor(
        private readonly fedExProvider: FedExProvider,
        private readonly jamefProvider: JamefProvider,
        private readonly azulCargoProvider: AzulCargoProvider,
        private readonly correiosProvider: CorreiosProvider,
        private readonly uberProvider: UberProvider,
    ) {
        this.providers.push(fedExProvider);
        this.providers.push(jamefProvider);
        this.providers.push(azulCargoProvider);
        this.providers.push(correiosProvider);
        this.providers.push(uberProvider);
    }

    async getQuotes(params: FreightQuoteParams): Promise<FreightQuoteResult[]> {
        const promises = this.providers.map(async (provider) => {
            try {
                return await provider.getQuote(params);
            } catch (error) {
                // Log error but don't fail the entire request if one provider fails
                console.error(`Provider ${provider.name} failed:`, error.message);
                return [];
            }
        });

        const results = await Promise.all(promises);
        const flatResults = results.flat();

        // Enrich with logo
        return flatResults.map(quote => {
            const logo = CARRIER_LOGOS[quote.provider] || CARRIER_LOGOS[quote.provider.toUpperCase()] || null;

            return {
                ...quote,
                company: {
                    name: quote.provider,
                    logo: logo
                }
            };
        });
    }
}
