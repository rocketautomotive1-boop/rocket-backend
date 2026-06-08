import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { ProductPricingModel, ProductPricingSchema } from './schemas/product-pricing.schema';
import { PricingRepository } from './pricing.repository';
import { PricingService } from './pricing.service';

describe('PricingService (integration)', () => {
  let mongo: MongoMemoryServer;
  let mod: TestingModule;
  let svc: PricingService;
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

  it('setPricingMeta stores markup + listPrice', async () => {
    await svc.setPricingMeta(PID, { markup: 1.5, strategy: 'FIXED_MARKUP', listPrice: 199.9 });
    const v = await svc.getPricing(PID);
    expect(v?.meta?.markup).toBe(1.5);
    expect(v?.listPrice).toBeCloseTo(199.9, 2);
  });
});
