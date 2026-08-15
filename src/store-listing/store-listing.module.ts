import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { StoreListingModel, StoreListingSchema } from './schemas/store-listing.schema';
import { MarketplaceListingModel, MarketplaceListingSchema } from './schemas/marketplace-listing.schema';
import { StoreListingStockLotModel, StoreListingStockLotSchema } from './schemas/store-listing-stock-lot.schema';
import { StoreListingStockBalanceModel, StoreListingStockBalanceSchema } from './schemas/store-listing-stock-balance.schema';
import { StoreListingStockMovementModel, StoreListingStockMovementSchema } from './schemas/store-listing-stock-movement.schema';
import { StoreListingWarehouseModel, StoreListingWarehouseSchema } from './schemas/store-listing-warehouse.schema';
import { StoreListingDamagedUnitModel, StoreListingDamagedUnitSchema } from './schemas/store-listing-damaged-unit.schema';
import { StoreListingDamagedAllocationModel, StoreListingDamagedAllocationSchema } from './schemas/store-listing-damaged-allocation.schema';
import { StoreListingService } from './store-listing.service';
import { STORE_LISTING_PORT } from './ports/store-listing.port';

/**
 * Aggregate root de "produto vendido numa loja". Nunca importa ProductModule
 * nem StoreModule — productId/storeId são ObjectIds opacos. Consumidores
 * externos (Order, MarketplaceOrchestrator, CostSimulator — nenhum ainda
 * wireado nesta fase) devem injetar STORE_LISTING_PORT, nunca
 * StoreListingService diretamente.
 *
 * Fase 1 (expand) do plano de migração: identidade + marketplace_listings.
 * Fase 2 registra também os schemas de estoque (store_listing_stock_lots/
 * balances/movements) aqui no forFeature, para o script de backfill
 * (app.get(getModelToken(...))) — mas eles ainda não são consumidos por
 * nenhum service nem expostos via STORE_LISTING_PORT; isso é trabalho da
 * Fase 3.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: StoreListingModel.name, schema: StoreListingSchema },
      { name: MarketplaceListingModel.name, schema: MarketplaceListingSchema },
      { name: StoreListingStockLotModel.name, schema: StoreListingStockLotSchema },
      { name: StoreListingStockBalanceModel.name, schema: StoreListingStockBalanceSchema },
      { name: StoreListingStockMovementModel.name, schema: StoreListingStockMovementSchema },
      { name: StoreListingWarehouseModel.name, schema: StoreListingWarehouseSchema },
      { name: StoreListingDamagedUnitModel.name, schema: StoreListingDamagedUnitSchema },
      { name: StoreListingDamagedAllocationModel.name, schema: StoreListingDamagedAllocationSchema },
    ]),
  ],
  providers: [StoreListingService, { provide: STORE_LISTING_PORT, useExisting: StoreListingService }],
  exports: [STORE_LISTING_PORT],
})
export class StoreListingModule {}
