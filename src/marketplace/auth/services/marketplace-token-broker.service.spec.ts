import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { MarketplaceModel } from '../../schemas/marketplace.schema';
import { MarketplaceTokenBrokerService, canonicalDomain } from './marketplace-token-broker.service';
import { MarketplaceCredentialsService } from '../../credentials/marketplace-credentials.service';
import { MarketplaceAdapterRegistry } from '../../registries/marketplace-adapter.registry';
import { MarketplaceConfigCacheService } from '../../services/marketplace-config-cache.service';
import { encrypt } from '../../credentials/credentials-crypto.helper';

/**
 * Valida o broker unificado (accounts[]) SEM Mongo real: o MarketplaceModel é
 * mockado. Cobre resolução por domínio (com normalização autoparts→autopecas),
 * ensureValidToken e o grafo de DI do subsistema de token (sem forwardRef).
 */
describe('MarketplaceTokenBrokerService', () => {
  const MP_ID = '6955b688dfe7143a30376b16';
  const ACC_ID = '6955b688dfe7143a30376bbb';

  let broker: MarketplaceTokenBrokerService;
  let modelMock: any;
  let adapterMock: any;

  const marketplaceDoc = (accounts: any[]) => ({
    _id: MP_ID,
    tag: 'mercadolivre',
    accounts,
  });

  beforeAll(() => {
    process.env.MP_CRYPTO_KEY = process.env.MP_CRYPTO_KEY || 'test-key-for-broker-spec';
  });

  beforeEach(async () => {
    modelMock = {
      findById: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
      updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
    };
    adapterMock = {
      name: 'Mercado Livre',
      tag: 'mercadolivre',
      refreshToken: jest.fn(),
      authenticate: jest.fn(),
      generateAuthUrl: jest.fn().mockResolvedValue({ authUrl: 'https://auth?x' }),
    };

    const registry = new MarketplaceAdapterRegistry();
    registry.registerAuthAdapter(adapterMock as any);

    const moduleRef = await Test.createTestingModule({
      providers: [
        MarketplaceTokenBrokerService,
        { provide: getModelToken(MarketplaceModel.name), useValue: modelMock },
        { provide: MarketplaceCredentialsService, useValue: { get: jest.fn().mockResolvedValue(undefined) } },
        { provide: MarketplaceAdapterRegistry, useValue: registry },
        { provide: MarketplaceConfigCacheService, useValue: { resolveId: jest.fn().mockResolvedValue(null), invalidate: jest.fn() } },
      ],
    }).compile();

    broker = moduleRef.get(MarketplaceTokenBrokerService);
  });

  it('canonicalDomain normaliza autoparts → autopecas', () => {
    expect(canonicalDomain('autoparts')).toBe('autopecas');
    expect(canonicalDomain(undefined)).toBe('autopecas');
    expect(canonicalDomain('general')).toBe('general');
  });

  it('accountFor: match exato por domínio', async () => {
    const accounts = [
      { _id: ACC_ID, label: 'general', isDefault: false, domains: ['general'], credentials: {}, token: { accessToken: 'AT', isActive: true } },
      { _id: '111111111111111111111111', label: 'autopecas-default', isDefault: true, domains: ['autopecas'], credentials: {}, token: { accessToken: 'AT2', isActive: true } },
    ];
    modelMock.findById.mockReturnValue({ lean: () => ({ exec: () => Promise.resolve(marketplaceDoc(accounts)) }) });

    const acc = await broker.accountFor(MP_ID, 'general');
    expect(acc?.label).toBe('general');
  });

  it('accountFor: domínio autoparts casa a conta autopecas (normalização)', async () => {
    const accounts = [
      { _id: ACC_ID, label: 'autopecas-default', isDefault: true, domains: ['autopecas'], credentials: {}, token: { accessToken: 'AT', isActive: true } },
    ];
    modelMock.findById.mockReturnValue({ lean: () => ({ exec: () => Promise.resolve(marketplaceDoc(accounts)) }) });

    const acc = await broker.accountFor(MP_ID, 'autoparts');
    expect(acc?.label).toBe('autopecas-default');
  });

  it('accountFor: sem domínio cai na conta default', async () => {
    const accounts = [
      { _id: ACC_ID, label: 'general', isDefault: false, domains: ['general'], credentials: {}, token: { accessToken: 'AT', isActive: true } },
      { _id: '111111111111111111111111', label: 'def', isDefault: true, domains: ['autopecas'], credentials: {}, token: { accessToken: 'AT2', isActive: true } },
    ];
    modelMock.findById.mockReturnValue({ lean: () => ({ exec: () => Promise.resolve(marketplaceDoc(accounts)) }) });

    const acc = await broker.accountFor(MP_ID, 'inexistente');
    expect(acc?.label).toBe('def');
  });

  it('ensureValidToken: devolve o accessToken válido (não expirando)', async () => {
    const future = new Date(Date.now() + 3600_000);
    const accounts = [
      { _id: ACC_ID, label: 'def', isDefault: true, domains: ['autopecas'], credentials: {}, token: { accessToken: 'AT', refreshToken: 'RT', expiresAt: future, additionalData: { userId: 9 }, isActive: true } },
    ];
    modelMock.findById.mockReturnValue({ lean: () => ({ exec: () => Promise.resolve(marketplaceDoc(accounts)) }) });

    const resolved = await broker.ensureValidToken(MP_ID, 'autopecas');
    expect(resolved.accessToken).toBe('AT');
    expect(resolved.additionalData.userId).toBe(9);
    expect(adapterMock.refreshToken).not.toHaveBeenCalled();
  });

  it('ensureValidToken: renova quando expirando e persiste', async () => {
    const past = new Date(Date.now() + 60_000); // dentro do buffer de 30min
    const accounts = [
      { _id: ACC_ID, label: 'def', isDefault: true, domains: ['autopecas'], credentials: { clientId: encrypt('CID'), clientSecret: encrypt('CS') }, token: { accessToken: 'OLD', refreshToken: 'RT', expiresAt: past, additionalData: {}, isActive: true } },
    ];
    modelMock.findById.mockReturnValue({ lean: () => ({ exec: () => Promise.resolve(marketplaceDoc(accounts)) }) });
    adapterMock.refreshToken.mockResolvedValue({ accessToken: 'NEW', refreshToken: 'RT2', expiresAt: new Date(Date.now() + 3600_000), additionalData: {}, isActive: true });

    await broker.ensureValidToken(MP_ID, 'autopecas');
    expect(adapterMock.refreshToken).toHaveBeenCalled();
    expect(modelMock.updateOne).toHaveBeenCalled();
  });

  it('ensureValidToken: lança se não há conta', async () => {
    modelMock.findById.mockReturnValue({ lean: () => ({ exec: () => Promise.resolve(marketplaceDoc([])) }) });
    await expect(broker.ensureValidToken(MP_ID, 'autopecas')).rejects.toBeDefined();
  });
});
