import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { FiscalCustomerService } from './fiscal-customer.service';
import { FiscalCustomerModel } from '../schemas/fiscal-customer.schema';

describe('FiscalCustomerService', () => {
  let service: FiscalCustomerService;
  let model: any;

  beforeEach(async () => {
    model = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      findOneAndUpdate: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        FiscalCustomerService,
        { provide: getModelToken(FiscalCustomerModel.name), useValue: model },
      ],
    }).compile();

    service = moduleRef.get(FiscalCustomerService);
  });

  describe('findByDocument', () => {
    it('normaliza o documento (remove máscara) antes de buscar', async () => {
      model.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue({ document: '06726952430' }) });

      await service.findByDocument('067.269.524-30');

      expect(model.findOne).toHaveBeenCalledWith({ document: '06726952430' });
    });

    it('retorna null sem consultar quando o documento fica vazio após normalizar', async () => {
      const result = await service.findByDocument('---');
      expect(result).toBeNull();
      expect(model.findOne).not.toHaveBeenCalled();
    });
  });

  describe('upsert', () => {
    it('cria um novo cadastro quando o documento não existe', async () => {
      model.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      model.create.mockResolvedValue({ document: '06726952430', ordersCount: 1 });

      await service.upsert({ document: '06726952430', documentType: 'CPF', name: 'Cliente Teste' });

      expect(model.create).toHaveBeenCalledWith(expect.objectContaining({
        document: '06726952430', documentType: 'CPF', name: 'Cliente Teste', ordersCount: 1,
      }));
    });

    it('incrementa ordersCount e atualiza lastUsedAt em cadastro existente', async () => {
      const existing = {
        document: '06726952430', name: 'Nome Antigo', addresses: [], ordersCount: 3,
        ieIndicator: 'NON_CONTRIBUTOR', lastUsedAt: new Date('2020-01-01'),
        save: jest.fn().mockResolvedValue(undefined),
      };
      model.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(existing) });

      const result = await service.upsert({ document: '06726952430', documentType: 'CPF', name: 'Nome Novo' });

      expect(result.name).toBe('Nome Novo');
      expect(result.ordersCount).toBe(4);
      expect(existing.save).toHaveBeenCalled();
    });

    it('não duplica endereço já presente (mesma rua/número/CEP)', async () => {
      const address = { street: 'Rua A', number: '1', neighborhood: 'B', city: 'C', state: 'PE', zipCode: '50000000' };
      const existing = {
        document: '06726952430', name: 'X', addresses: [address], ordersCount: 1,
        ieIndicator: 'NON_CONTRIBUTOR', save: jest.fn().mockResolvedValue(undefined),
      };
      model.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(existing) });

      await service.upsert({ document: '06726952430', documentType: 'CPF', name: 'X', address });

      expect(existing.addresses).toHaveLength(1);
    });
  });
});
