import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MarketplaceModel, MarketplaceSchema } from '../schemas/marketplace.schema';
import { MarketplaceCredentialsService } from './marketplace-credentials.service';

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MarketplaceModel.name, schema: MarketplaceSchema },
    ]),
  ],
  providers: [MarketplaceCredentialsService],
  exports: [MarketplaceCredentialsService],
})
export class MarketplaceCredentialsModule {}
