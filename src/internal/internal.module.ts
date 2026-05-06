import { Module } from '@nestjs/common';
import { InternalTokenController } from './internal-token.controller';
import { MarketplaceAuthModule } from '../marketplace/auth/marketplace-auth.module';
import { MarketplaceRegistryModule } from '../marketplace/marketplace-registry.module';

@Module({
    imports: [MarketplaceAuthModule, MarketplaceRegistryModule],
    controllers: [InternalTokenController],
})
export class InternalModule {}
