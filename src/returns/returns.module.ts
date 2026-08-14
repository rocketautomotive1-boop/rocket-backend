import { Module } from '@nestjs/common';
import { MarketplaceAuthModule } from '../marketplace/auth/marketplace-auth.module';
import { MlClaimsClient } from './ml/ml-claims.client';
import { ReturnWebhookListener } from './return-webhook.listener';

/**
 * Owns post-sale returns/claims notifications (ML `claims` topic).
 *
 * Narrow deps to avoid module cycles (CLAUDE.md), same shape as ModerationModule:
 *  - MarketplaceAuthModule      → MarketplaceTokenBrokerService (live token, multi-account).
 *  - MarketplaceRegistryService → injected from the @Global MarketplaceRegistryModule.
 *  - EventEmitter2 (global)     → webhook trigger in, notifications out. No heavy imports.
 *
 * Detector only: the listener fetches the claim and emits a NotificationRequested
 * (app + WhatsApp). It never mutates orders/stock.
 */
@Module({
  imports: [MarketplaceAuthModule],
  providers: [MlClaimsClient, ReturnWebhookListener],
})
export class ReturnsModule {}
