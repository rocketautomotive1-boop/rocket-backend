import { BadRequestException, HttpException } from '@nestjs/common';
import { PriceTrackerController } from './price-tracker.controller';
import { Types } from 'mongoose';

describe('PriceTrackerController', () => {
  let itemModel: any;
  let worker: { scanEan: jest.Mock };
  let query: any;
  let categories: any;
  let controller: PriceTrackerController;

  beforeEach(() => {
    itemModel = {
      create: jest.fn().mockResolvedValue({ _id: new Types.ObjectId(), ean: '7896000001504' }),
      findById: jest.fn().mockReturnValue({ lean: () => ({ exec: async () => ({ _id: 'i1', ean: '7896000001504' }) }) }),
      findByIdAndUpdate: jest.fn().mockReturnValue({ lean: () => ({ exec: async () => ({ _id: 'i1' }) }) }),
      findByIdAndDelete: jest.fn().mockReturnValue({ lean: () => ({ exec: async () => ({ _id: 'i1' }) }) }),
    };
    worker = { scanEan: jest.fn().mockResolvedValue(undefined) };
    query = { listItemsPaged: jest.fn(), history: jest.fn(), deals: jest.fn(), offers: jest.fn() };
    categories = { list: jest.fn(), create: jest.fn(), update: jest.fn(), remove: jest.fn() };
    controller = new PriceTrackerController(itemModel, worker as any, query, categories);
  });

  it('POST /items valida com Zod e dispara scan imediato (fire-and-forget)', async () => {
    await controller.create({ ean: '7896000001504', name: 'Coca' });
    expect(itemModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ ean: '7896000001504', name: 'Coca', discountThresholdPct: 15 }),
    );
    expect(worker.scanEan).toHaveBeenCalledWith('7896000001504');
  });

  it('POST /items com body inválido → BadRequestException em português', async () => {
    await expect(controller.create({ ean: '123', name: 'X' })).rejects.toThrow(BadRequestException);
  });

  it('POST /items com EAN duplicado (E11000) → mensagem amigável', async () => {
    itemModel.create.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 11000 }));
    await expect(controller.create({ ean: '7896000001504', name: 'Coca' }))
      .rejects.toThrow(/já está sendo monitorado/);
  });

  it('POST /items/:id/scan aplica throttle de 5min por item', async () => {
    await controller.scan('i1');
    expect(worker.scanEan).toHaveBeenCalledTimes(1);
    await expect(controller.scan('i1')).rejects.toThrow(HttpException); // 429 dentro da janela
  });

  it('GET /items/:id/offers aplica defaults e clampa pageSize a 50', async () => {
    await controller.offers('i1', undefined, undefined);
    expect(query.offers).toHaveBeenCalledWith('i1', 1, 20);

    await controller.offers('i1', '2', '999');
    expect(query.offers).toHaveBeenCalledWith('i1', 2, 50);

    await controller.offers('i1', '0', '-5');
    expect(query.offers).toHaveBeenCalledWith('i1', 1, 1);
  });

  it('GET /items repassa search e categoryId; sentinel "none" vira null; aplica defaults de página', async () => {
    await controller.list('coca', undefined, undefined, undefined);
    expect(query.listItemsPaged).toHaveBeenCalledWith({
      search: 'coca', categoryId: undefined, page: 1, pageSize: 20,
    });

    await controller.list(undefined, 'cat1', undefined, undefined);
    expect(query.listItemsPaged).toHaveBeenCalledWith({
      search: undefined, categoryId: 'cat1', page: 1, pageSize: 20,
    });

    await controller.list(undefined, 'none', undefined, undefined);
    expect(query.listItemsPaged).toHaveBeenCalledWith({
      search: undefined, categoryId: null, page: 1, pageSize: 20,
    });
  });

  it('GET /items clampa page/pageSize', async () => {
    await controller.list(undefined, undefined, '3', '50');
    expect(query.listItemsPaged).toHaveBeenCalledWith(
      expect.objectContaining({ page: 3, pageSize: 50 }),
    );

    await controller.list(undefined, undefined, '0', '999');
    expect(query.listItemsPaged).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, pageSize: 100 }),
    );
  });

  it('POST /categories valida nome e delega ao service', async () => {
    await controller.createCategory({ name: 'Limpeza' });
    expect(categories.create).toHaveBeenCalledWith('Limpeza');
    await expect(controller.createCategory({ name: '' })).rejects.toThrow(BadRequestException);
  });

  it('DELETE /categories/:id remove e retorna confirmação', async () => {
    const result = await controller.removeCategory('cat1');
    expect(categories.remove).toHaveBeenCalledWith('cat1');
    expect(result).toEqual({ removed: true });
  });
});
