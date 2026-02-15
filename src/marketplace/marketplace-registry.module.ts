import { Module, Global } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MarketplaceRegistryService } from './services/marketplace-registry.service';
import { MarketplaceAdapterRegistry } from './registries/marketplace-adapter.registry';
import { MarketplaceModel, MarketplaceSchema } from './schemas/marketplace.schema';
import { MarketplaceToken, MarketplaceTokenSchema } from './schemas/marketplace-token.schema';
import { PublicationAttempt, PublicationAttemptSchema } from './schemas/publication-attempt.schema';
import { PublicationLogService } from './services/publication-log.service';

@Global()
@Module({
    imports: [
        MongooseModule.forFeature([
            { name: MarketplaceModel.name, schema: MarketplaceSchema },
            { name: MarketplaceToken.name, schema: MarketplaceTokenSchema },
            { name: PublicationAttempt.name, schema: PublicationAttemptSchema },
        ]),
    ],
    providers: [
        MarketplaceRegistryService,
        MarketplaceAdapterRegistry,
        PublicationLogService
    ],
    exports: [
        MarketplaceRegistryService,
        MarketplaceAdapterRegistry,
        PublicationLogService
    ],
})
export class MarketplaceRegistryModule { }
