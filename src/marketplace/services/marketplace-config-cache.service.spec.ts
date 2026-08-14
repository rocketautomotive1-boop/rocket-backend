import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { MarketplaceModel } from '../schemas/marketplace.schema';
import { MarketplaceConfigCacheService } from './marketplace-config-cache.service';

/**
 * Valida o cache write-through de config: 1 query por hidratação (não por
 * leitura), strip do token volátil, freeze e re-hidratação após invalidate().
 */
describe('MarketplaceConfigCacheService', () => {
  const MP_ID = '6955b688dfe7143a30376b16';

  let cache: MarketplaceConfigCacheService;
  let execMock: jest.Mock;
  let findMock: jest.Mock;

  const docs = () => [
    {
      _id: MP_ID,
      name: 'Mercado Livre',
      tag: 'mercadolivre',
      enabled: true,
      credentials: { partnerKey: 'enc:v1:x' },
      accounts: [
        { _id: 'a1', label: 'default', domains: ['autopecas'], credentials: {}, token: { accessToken: 'SECRET' } },
      ],
    },
  ];

  beforeEach(async () => {
    execMock = jest.fn().mockImplementation(() => Promise.resolve(docs()));
    findMock = jest.fn().mockReturnValue({ lean: () => ({ exec: execMock }) });

    const moduleRef = await Test.createTestingModule({
      providers: [
        MarketplaceConfigCacheService,
        { provide: getModelToken(MarketplaceModel.name), useValue: { find: findMock } },
      ],
    }).compile();

    cache = moduleRef.get(MarketplaceConfigCacheService);
  });

  it('consulta o Mongo só uma vez para N leituras (cache hit)', async () => {
    await cache.getById(MP_ID);
    await cache.getByTag('mercadolivre');
    await cache.getByName('Mercado Livre');
    await cache.resolveId('mercadolivre');
    expect(findMock).toHaveBeenCalledTimes(1);
  });

  it('resolveId mapeia tag/name → id e passa ObjectId direto', async () => {
    expect(await cache.resolveId('mercadolivre')).toBe(MP_ID);
    expect(await cache.resolveId('Mercado Livre')).toBe(MP_ID);
    expect(await cache.resolveId(MP_ID)).toBe(MP_ID); // já é id: nem hidrata
  });

  it('strip do token volátil — config cacheada não vaza accessToken', async () => {
    const cfg: any = await cache.getById(MP_ID);
    expect(cfg.accounts[0].label).toBe('default');
    expect(cfg.accounts[0].token).toBeUndefined();
  });

  it('objeto retornado é congelado (imutável)', async () => {
    const cfg: any = await cache.getById(MP_ID);
    expect(Object.isFrozen(cfg)).toBe(true);
    expect(Object.isFrozen(cfg.accounts[0])).toBe(true);
  });

  it('invalidate() força re-hidratação na próxima leitura', async () => {
    await cache.getById(MP_ID);
    expect(findMock).toHaveBeenCalledTimes(1);
    cache.invalidate();
    await cache.getById(MP_ID);
    expect(findMock).toHaveBeenCalledTimes(2);
  });

  it('id inválido não toca o Mongo', async () => {
    expect(await cache.getById('not-an-id')).toBeNull();
    expect(findMock).not.toHaveBeenCalled();
  });
});
