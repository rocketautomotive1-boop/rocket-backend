import { NotFoundException } from '@nestjs/common';
import { PriceTrackerCategoriesService } from './price-tracker-categories.service';

describe('PriceTrackerCategoriesService', () => {
  let categoryModel: any;
  let itemModel: any;
  let service: PriceTrackerCategoriesService;

  beforeEach(() => {
    categoryModel = {
      find: jest.fn().mockReturnValue({ sort: () => ({ lean: () => ({ exec: async () => [] }) }) }),
      create: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      findByIdAndDelete: jest.fn(),
    };
    itemModel = { updateMany: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }) };
    service = new PriceTrackerCategoriesService(categoryModel, itemModel);
  });

  it('list() mapeia _id para id string', async () => {
    categoryModel.find.mockReturnValue({
      sort: () => ({ lean: () => ({ exec: async () => [{ _id: 'a', name: 'Limpeza' }] }) }),
    });
    const result = await service.list();
    expect(result).toEqual([{ id: 'a', name: 'Limpeza' }]);
  });

  it('create() mapeia o doc criado', async () => {
    categoryModel.create.mockResolvedValue({ _id: 'a', name: 'Bebidas' });
    const result = await service.create('Bebidas');
    expect(result).toEqual({ id: 'a', name: 'Bebidas' });
  });

  it('create() com nome duplicado (E11000) → mensagem amigável', async () => {
    categoryModel.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 11000 }));
    await expect(service.create('Bebidas')).rejects.toThrow(/já existe/i);
  });

  it('remove() desatribui os itens da categoria (categoryId: null) e não os apaga', async () => {
    categoryModel.findByIdAndDelete.mockReturnValue({ lean: () => ({ exec: async () => ({ _id: 'a' }) }) });
    await service.remove('a');
    expect(itemModel.updateMany).toHaveBeenCalledWith(
      { categoryId: 'a' },
      { $set: { categoryId: null } },
    );
  });

  it('remove() de categoria inexistente → NotFoundException', async () => {
    categoryModel.findByIdAndDelete.mockReturnValue({ lean: () => ({ exec: async () => null }) });
    await expect(service.remove('nope')).rejects.toThrow(NotFoundException);
    expect(itemModel.updateMany).not.toHaveBeenCalled();
  });
});
