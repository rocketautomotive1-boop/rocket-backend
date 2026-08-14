import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { MarketplaceModel } from '../../schemas/marketplace.schema';
import { MarketplaceTokenBrokerService } from './marketplace-token-broker.service';
import { TokenManagerService } from './token-manager.service';
import { MarketplaceAuthService } from './marketplace-auth.service';
import { MarketplaceCredentialsService } from '../../credentials/marketplace-credentials.service';
import { MarketplaceAdapterRegistry } from '../../registries/marketplace-adapter.registry';
import { MarketplaceRegistryService } from '../../services/marketplace-registry.service';
import { MarketplaceConfigCacheService } from '../../services/marketplace-config-cache.service';

/**
 * Boot test de DI do subsistema de auth/token: prova que o grafo
 * AuthService → TokenManager → Broker → AdapterRegistry resolve SEM forwardRef
 * (nenhum @Inject(forwardRef(...)) entre eles). Se houvesse ciclo de construção,
 * o .compile() lançaria.
 *
 * Bordas (Mongo model, MarketplaceRegistryService, CredentialsService) são
 * mockadas — o foco é o grafo de dependências, não o comportamento.
 */
describe('Auth subsystem DI graph (no forwardRef cycles)', () => {
  it('compila AuthService + TokenManager + Broker sem ciclo', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [
        MarketplaceAuthService,
        TokenManagerService,
        MarketplaceTokenBrokerService,
        MarketplaceAdapterRegistry,
        { provide: getModelToken(MarketplaceModel.name), useValue: { findById: jest.fn(), findOne: jest.fn(), find: jest.fn(), updateOne: jest.fn() } },
        { provide: MarketplaceCredentialsService, useValue: { get: jest.fn() } },
        { provide: MarketplaceRegistryService, useValue: { findOne: jest.fn(), findByName: jest.fn(), findByTag: jest.fn() } },
        { provide: MarketplaceConfigCacheService, useValue: { resolveId: jest.fn(), invalidate: jest.fn() } },
      ],
    }).compile();

    expect(moduleRef.get(MarketplaceAuthService)).toBeInstanceOf(MarketplaceAuthService);
    expect(moduleRef.get(TokenManagerService)).toBeInstanceOf(TokenManagerService);
    expect(moduleRef.get(MarketplaceTokenBrokerService)).toBeInstanceOf(MarketplaceTokenBrokerService);
    expect(moduleRef.get(MarketplaceAdapterRegistry)).toBeInstanceOf(MarketplaceAdapterRegistry);
  });
});
