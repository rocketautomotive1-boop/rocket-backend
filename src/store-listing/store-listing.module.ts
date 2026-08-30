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
import { AllocationModel, AllocationSchema } from '../product/schemas/allocation.schema';
import { ProductModel, ProductSchema } from '../product/schemas/product.schema';
import { ListingModel, ListingSchema } from '../listing/schemas/listing.schema';
import { OwnershipTransferLogModel, OwnershipTransferLogSchema } from './schemas/ownership-transfer-log.schema';
import { StoreListingService } from './store-listing.service';
import { StoreOwnerLookupService } from './store-owner-lookup.service';
import { StoreListingOwnershipService } from './ownership-transfer.service';
import { StoreListingController } from './store-listing.controller';
import { STORE_LISTING_PORT } from './ports/store-listing.port';
import { STORE_OWNER_LOOKUP_PORT } from './ports/store-owner-lookup.port';
import { AuthModule } from '../auth/auth.module';
import { PricingModule } from '../pricing/pricing.module';

/**
 * Aggregate root de "produto vendido numa loja". Nunca importa ProductModule
 * nem StoreModule — productId/storeId são ObjectIds opacos. Consumidores
 * externos (Order, MarketplaceOrchestrator, CostSimulator) devem injetar
 * STORE_LISTING_PORT, nunca StoreListingService diretamente.
 *
 * StoreListingController expõe depósitos e unidades avariadas via HTTP —
 * importa AuthModule (mesmo padrão de StockModule) só para JwtAuthGuard.
 *
 * Fase 1 (expand) do plano de migração: identidade + marketplace_listings.
 * Fase 2 registra também os schemas de estoque (store_listing_stock_lots/
 * balances/movements) aqui no forFeature, para o script de backfill
 * (app.get(getModelToken(...))) — mas eles ainda não são consumidos por
 * nenhum service nem expostos via STORE_LISTING_PORT; isso é trabalho da
 * Fase 3.
 *
 * getAllocationProducts (allocations store-aware) precisa de STOCK_QUERY_PORT
 * (join de estoque/preço, portado de ProductAllocationService). StockModule já
 * importa StoreListingModule (dual-write, fase 3) — um import de volta criaria
 * ciclo, então StockModule é @Global (mesmo padrão de StoreModule) e o port é
 * injetado aqui sem import direto. PRICING_PORT vem de PricingModule, folha
 * (sem import de domínio), sem risco de ciclo.
 *
 * STORE_OWNER_LOOKUP_PORT (StoreOwnerLookupService): port folha só com
 * findStoreIdByProduct — existe para que consumidores que só precisam da loja
 * dona de um produto (StockLedgerProvider, StoreListingStockQueryService) não
 * injetem STORE_LISTING_PORT inteiro. Extraído em 2026-08-29 depois de um
 * ciclo real de instanciação: StoreListingService injeta STOCK_QUERY_PORT
 * (getAllocationProducts) e, quando STOCK_QUERY_PORT passou a apontar para um
 * provider que injetava STORE_LISTING_PORT de volta, o boot travava
 * silenciosamente (sem erro, sem log) — Nest nunca detectou/reportou o ciclo,
 * só parou de progredir. Nenhum consumidor deve voltar a injetar
 * STORE_LISTING_PORT só para resolver a loja de um produto.
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
      { name: AllocationModel.name, schema: AllocationSchema },
      { name: ProductModel.name, schema: ProductSchema },
      { name: ListingModel.name, schema: ListingSchema },
      { name: OwnershipTransferLogModel.name, schema: OwnershipTransferLogSchema },
    ]),
    AuthModule,
    PricingModule,
  ],
  controllers: [StoreListingController],
  providers: [
    StoreListingService,
    StoreOwnerLookupService,
    StoreListingOwnershipService,
    { provide: STORE_LISTING_PORT, useExisting: StoreListingService },
    { provide: STORE_OWNER_LOOKUP_PORT, useExisting: StoreOwnerLookupService },
  ],
  exports: [STORE_LISTING_PORT, STORE_OWNER_LOOKUP_PORT, StoreListingOwnershipService],
})
export class StoreListingModule {}
