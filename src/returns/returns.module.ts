import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MarketplaceAuthModule } from '../marketplace/auth/marketplace-auth.module';
import { OrderModel, OrderSchema } from '../order/schemas/order.schema';
import { OrderRepository } from '../order/order.repository';
import { MlClaimsClient } from './ml/ml-claims.client';
import { ReturnWebhookListener } from './return-webhook.listener';

/**
 * Owns post-sale returns/claims notifications (ML `claims` topic) + the resulting
 * `returnState` on the order.
 *
 * Narrow deps to avoid module cycles (CLAUDE.md), same shape as ModerationModule:
 *  - MarketplaceAuthModule      → MarketplaceTokenBrokerService (live token, multi-account).
 *  - MarketplaceRegistryService → injected from the @Global MarketplaceRegistryModule.
 *  - EventEmitter2 (global)     → webhook trigger in, notifications out.
 *  - OrderModel via forFeature  → OrderRepository provided locally (like FiscalModule),
 *    NOT importing the full OrderModule, which would drag in Marketplace/Product/Stock
 *    and risk the module cycle documented in [[marketplace-auth-module-cycle]].
 *
 * Detector + minimal writer: fetches the claim, emits a NotificationRequested
 * (app + WhatsApp), and writes `returnState` on the order. Never touches stock/fiscal.
 */
@Module({
  imports: [
    MarketplaceAuthModule,
    MongooseModule.forFeature([{ name: OrderModel.name, schema: OrderSchema }]),
  ],
  providers: [MlClaimsClient, ReturnWebhookListener, OrderRepository],
})
export class ReturnsModule {}
