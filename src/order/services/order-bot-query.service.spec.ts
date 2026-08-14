import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { OrderModel, OrderSchema } from '../schemas/order.schema';
import { OrderBotQueryService } from './order-bot-query.service';

/**
 * Garante que o relatório de "vendas" filtra pela DATA REAL da venda no marketplace
 * (marketplaceCreatedAt), não pela data de ingestão (createdAt). Pedidos legados sem
 * marketplaceCreatedAt caem no createdAt.
 */
describe('OrderBotQueryService.getSalesReport (date filter)', () => {
  let mongo: MongoMemoryReplSet;
  let moduleRef: TestingModule;
  let service: OrderBotQueryService;
  let orderModel: Model<any>;

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(mongo.getUri()),
        MongooseModule.forFeature([{ name: OrderModel.name, schema: OrderSchema }]),
      ],
      providers: [OrderBotQueryService],
    }).compile();

    service = moduleRef.get(OrderBotQueryService);
    orderModel = moduleRef.get<Model<any>>(getModelToken(OrderModel.name));
  });

  afterAll(async () => {
    const conn = moduleRef.get<Connection>(getConnectionToken());
    await conn.close();
    await moduleRef.close();
    await mongo.stop();
  });

  beforeEach(async () => {
    await orderModel.deleteMany({});
  });

  // timestamps:true sobrescreve createdAt no insert; força a data via update direto.
  const insertOrder = async (doc: any, createdAt: Date) => {
    const created = await orderModel.create(doc);
    await orderModel.updateOne({ _id: created._id }, { $set: { createdAt } });
  };

  const todayNoon = () => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    return d;
  };
  const yesterdayNoon = () => {
    const d = todayNoon();
    d.setDate(d.getDate() - 1);
    return d;
  };

  it('excludes an order sold yesterday even if it was ingested today', async () => {
    await insertOrder(
      {
        externalId: 'OLD-SALE',
        marketplaceId: '650000000000000000000099',
        status: 'paid',
        totalAmount: 100,
        marketplaceCreatedAt: yesterdayNoon(), // vendido ontem
      },
      todayNoon(), // ingerido hoje (reconcile)
    );

    const report = await service.getSalesReport('today');

    expect(report).toContain('Nenhuma venda registrada hoje');
  });

  it('includes an order sold today regardless of ingestion time', async () => {
    await insertOrder(
      {
        externalId: 'TODAY-SALE',
        marketplaceId: '650000000000000000000099',
        status: 'paid',
        totalAmount: 100,
        marketplaceCreatedAt: todayNoon(),
      },
      yesterdayNoon(), // ingerido antes, não importa
    );

    const report = await service.getSalesReport('today');

    expect(report).toContain('1 pedidos');
  });

  it('falls back to createdAt for legacy orders without marketplaceCreatedAt', async () => {
    await insertOrder(
      {
        externalId: 'LEGACY',
        marketplaceId: '650000000000000000000099',
        status: 'paid',
        totalAmount: 100,
        // sem marketplaceCreatedAt
      },
      todayNoon(),
    );

    const report = await service.getSalesReport('today');

    expect(report).toContain('1 pedidos');
  });
});
