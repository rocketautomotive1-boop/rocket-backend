import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ModerationRepository } from './moderation.repository';
import { MercadoLivreModerationProvider } from './providers/mercadolivre-moderation.provider';
import { MlModerationsClient } from './ml/ml-moderations.client';
import { WrongCategoryHandler } from './handlers/wrong-category.handler';
import { MissingCompatibilityHandler } from './handlers/missing-compatibility.handler';
import { ModerationHandlerRegistry } from './handlers/moderation-handler.registry';
import { ModerationIngestService } from './ingest/moderation-ingest.service';
import { ModerationReconciler } from './reconcile/moderation-reconciler.service';
import { ModerationWebhookListener } from './webhook/moderation-webhook.listener';
import { ListingModel } from '../listing/schemas/listing.schema';
import { ProductModel } from '../product/schemas/product.schema';
import { ModerationStateModel } from './schemas/moderation-state.schema';
import { MarketplaceTokenBrokerService } from '../marketplace/auth/services/marketplace-token-broker.service';
import { OrchestratorPublisherService } from '../marketplace-orchestrator/orchestrator-publisher.service';
import { MarketplaceRegistryService } from '../marketplace/services/marketplace-registry.service';

/**
 * Proves the moderation provider graph wires together: each service resolves with its declared
 * constructor dependencies satisfied. External collaborators (token broker, publisher, registry,
 * mongoose models) are stubbed — if a service declared a hidden/extra dependency, resolution throws.
 * This mirrors ModerationModule's provider list exactly.
 */
describe('Moderation DI graph', () => {
  it('resolves all entrypoints with declared deps satisfied', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [
        ModerationRepository,
        MercadoLivreModerationProvider,
        MlModerationsClient,
        WrongCategoryHandler,
        MissingCompatibilityHandler,
        ModerationHandlerRegistry,
        ModerationIngestService,
        ModerationReconciler,
        ModerationWebhookListener,
        { provide: getModelToken(ListingModel.name), useValue: {} },
        { provide: getModelToken(ProductModel.name), useValue: {} },
        { provide: getModelToken(ModerationStateModel.name), useValue: {} },
        { provide: MarketplaceTokenBrokerService, useValue: {} },
        { provide: OrchestratorPublisherService, useValue: {} },
        { provide: MarketplaceRegistryService, useValue: {} },
      ],
    }).compile();

    expect(moduleRef.get(ModerationIngestService)).toBeDefined();
    expect(moduleRef.get(ModerationReconciler)).toBeDefined();
    expect(moduleRef.get(ModerationWebhookListener)).toBeDefined();
    expect(moduleRef.get(ModerationHandlerRegistry)).toBeDefined();

    await moduleRef.close();
  });
});
