import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { StockMovementModel, StockMovementSchema } from './schemas/stock-movement.schema';
import { StockLotModel, StockLotSchema } from './schemas/stock-lot.schema';
import { StockBalanceModel, StockBalanceSchema } from './schemas/stock-balance.schema';
import { StockRepository } from './stock.repository';
import { StockService } from './stock.service';
import { StockMovementType } from './domain/movement-type';

describe('StockService (integration)', () => {
  let mongo: MongoMemoryReplSet;
  let mod: TestingModule;
  let svc: StockService;
  let repo: StockRepository;
  const PID = '650000000000000000000001';

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    mod = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(mongo.getUri()),
        MongooseModule.forFeature([
          { name: StockMovementModel.name, schema: StockMovementSchema },
          { name: StockLotModel.name, schema: StockLotSchema },
          { name: StockBalanceModel.name, schema: StockBalanceSchema },
        ]),
      ],
      providers: [StockService, StockRepository],
    }).compile();
    svc = mod.get(StockService);
    repo = mod.get(StockRepository);

    // Pre-create collections + indexes. MongoDB cannot create a collection inside a
    // multi-document transaction, so creating them lazily during the first move() would
    // fail. In prod the migration/backfill creates them before any transactional write.
    await repo.lotModel.createCollection();
    await repo.balanceModel.createCollection();
    await repo.movementModel.createCollection();
    await repo.movementModel.syncIndexes();
    await repo.balanceModel.syncIndexes();
  });

  afterAll(async () => {
    const c = mod.get<Connection>(getConnectionToken());
    await c.close();
    await mod.close();
    await mongo.stop();
  });

  it('inbound then outbound nets correct onHand', async () => {
    await svc.move({ productId: PID, type: StockMovementType.INBOUND, quantity: 10, condition: 'new', unitCost: 2, reference: 'in-1' });
    await svc.move({ productId: PID, type: StockMovementType.OUTBOUND, quantity: 3, condition: 'new', reference: 'out-1' });
    const rows = await repo.balanceModel.find({ productId: new Types.ObjectId(PID) });
    const onHand = rows.reduce((s, r) => s + r.onHand, 0);
    expect(onHand).toBe(7);
  });

  it('duplicate reference is idempotent', async () => {
    await svc.move({ productId: PID, type: StockMovementType.INBOUND, quantity: 5, condition: 'new', reference: 'dup' });
    await svc.move({ productId: PID, type: StockMovementType.INBOUND, quantity: 5, condition: 'new', reference: 'dup' });
    const count = await repo.movementModel.countDocuments({ 'metadata.externalReference': 'dup' });
    expect(count).toBe(1);
  });

  it('reservation increments reserved without touching onHand', async () => {
    const onHandBefore = (await repo.balanceModel.find({ productId: new Types.ObjectId(PID) }))
      .reduce((s, r) => s + r.onHand, 0);
    await svc.move({ productId: PID, type: StockMovementType.RESERVATION, quantity: 2, condition: 'new', reference: 'res-1' });
    const rows = await repo.balanceModel.find({ productId: new Types.ObjectId(PID) });
    const reserved = rows.reduce((s, r) => s + r.reserved, 0);
    const onHandAfter = rows.reduce((s, r) => s + r.onHand, 0);
    expect(reserved).toBe(2);
    expect(onHandAfter).toBe(onHandBefore); // reservation doesn't change physical stock
  });
});
