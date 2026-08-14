import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { ProductPricingModel, ProductPricingSchema } from './schemas/product-pricing.schema';
import { PricingRepository } from './pricing.repository';
import { PricingService } from './pricing.service';

const dec = (n: number) => Types.Decimal128.fromString(String(n));

describe('PricingService (integration)', () => {
  let mongo: MongoMemoryServer;
  let mod: TestingModule;
  let svc: PricingService;
  let repo: PricingRepository;
  const PID = '650000000000000000000001';
  const M1 = '650000000000000000000aa1';
  const M2 = '650000000000000000000bb2';

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    mod = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(mongo.getUri()),
        MongooseModule.forFeature([{ name: ProductPricingModel.name, schema: ProductPricingSchema }]),
      ],
      providers: [PricingService, PricingRepository],
    }).compile();
    svc = mod.get(PricingService);
    repo = mod.get(PricingRepository);
  });

  afterAll(async () => {
    const c = mod.get<Connection>(getConnectionToken());
    await c.close();
    await mod.close();
    await mongo.stop();
  });

  it('setBasePrice then getEffectivePrice (no override) = base', async () => {
    await svc.setBasePrice(PID, 100);
    expect(await svc.getEffectivePrice(PID, M1)).toBe(100);
  });

  it('setOverride wins for that marketplace, base for others', async () => {
    await svc.setOverride(PID, M1, 130);
    expect(await svc.getEffectivePrice(PID, M1)).toBe(130);
    expect(await svc.getEffectivePrice(PID, M2)).toBe(100);
  });

  it('clearOverride reverts to base', async () => {
    await svc.clearOverride(PID, M1);
    expect(await svc.getEffectivePrice(PID, M1)).toBe(100);
  });

  it('no pricing doc → effective price null', async () => {
    expect(await svc.getEffectivePrice('650000000000000000000fff', M1)).toBeNull();
  });

  it('setPricingMeta stores markup', async () => {
    await svc.setPricingMeta(PID, { markup: 1.5, strategy: 'FIXED_MARKUP' });
    const v = await svc.getPricing(PID);
    expect(v?.meta?.markup).toBe(1.5);
  });

  it('setPromotion rejects listPrice <= basePrice', async () => {
    await svc.setBasePrice(PID, 100);
    await expect(
      svc.setPromotion(PID, { listPrice: 100, startsAt: new Date(), endsAt: new Date(Date.now() + 86400000) }),
    ).rejects.toThrow();
  });

  it('setPromotion rejects endsAt <= startsAt', async () => {
    const now = new Date();
    await expect(
      svc.setPromotion(PID, { listPrice: 999, startsAt: now, endsAt: now }),
    ).rejects.toThrow();
  });

  it('setPromotion then getPricing exposes listPrice while active', async () => {
    await svc.setBasePrice(PID, 100);
    await svc.setPromotion(PID, {
      listPrice: 150,
      startsAt: new Date(Date.now() - 1000),
      endsAt: new Date(Date.now() + 86400000),
    });
    const v = await svc.getPricing(PID);
    expect(v?.listPrice).toBeCloseTo(150, 2);
    expect(await svc.getActivePromotionProductIds()).toContain(PID);
  });

  it('getPricing hides listPrice once promotion has expired, even before the cleanup job runs', async () => {
    await svc.setBasePrice(PID, 100);
    // setPromotion valida endsAt > startsAt; grava direto no repo para simular expiração passada.
    await repo.upsertPromotion(PID, {
      listPrice: dec(150),
      startsAt: new Date(Date.now() - 2000),
      endsAt: new Date(Date.now() - 1000),
    });
    const v = await svc.getPricing(PID);
    expect(v?.listPrice).toBeUndefined();
  });

  it('clearPromotion removes the promotion', async () => {
    await svc.setBasePrice(PID, 100);
    await svc.setPromotion(PID, { listPrice: 150, startsAt: new Date(), endsAt: new Date(Date.now() + 86400000) });
    await svc.clearPromotion(PID);
    const v = await svc.getPricing(PID);
    expect(v?.listPrice).toBeUndefined();
  });
});
