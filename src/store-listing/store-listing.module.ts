import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { StoreListingModel, StoreListingSchema } from './schemas/store-listing.schema';
import { MarketplaceListingModel, MarketplaceListingSchema } from './schemas/marketplace-listing.schema';
import { StoreListingService } from './store-listing.service';
import { STORE_LISTING_PORT } from './ports/store-listing.port';

/**
 * Aggregate root de "produto vendido numa loja". Nunca importa ProductModule
 * nem StoreModule — productId/storeId são ObjectIds opacos. Consumidores
 * externos (Order, MarketplaceOrchestrator, CostSimulator — nenhum ainda
 * wireado nesta fase) devem injetar STORE_LISTING_PORT, nunca
 * StoreListingService diretamente.
 *
 * Fase 1 (expand) do plano de migração: só identidade + marketplace_listings.
 * Estoque/pricing/allocation são adicionados na Fase 2, quando o backfill
 * também é escrito.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: StoreListingModel.name, schema: StoreListingSchema },
      { name: MarketplaceListingModel.name, schema: MarketplaceListingSchema },
    ]),
  ],
  providers: [StoreListingService, { provide: STORE_LISTING_PORT, useExisting: StoreListingService }],
  exports: [STORE_LISTING_PORT],
})
export class StoreListingModule {}
