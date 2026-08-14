import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { FiscalService } from './fiscal.service';
import { FiscalDocumentModel, FiscalIssuerModel } from '../schemas/fiscal.schema';
import { XmlBuilderService } from './xml-builder.service';
import { SignatureService } from './signature.service';
import { SefazService } from './sefaz.service';
import { ProductService } from '../../product/product.service';
import { MarketplaceService } from '../../marketplace/services/marketplace.service';
import { MarketplaceOrderService } from '../../marketplace/services/marketplace-order.service';
import { MarketplaceRegistryService } from '../../marketplace/services/marketplace-registry.service';
import { OrderModel } from '../../order/schemas/order.schema';

describe('FiscalService — environment on new NFe', () => {
  let service: FiscalService;
  let fiscalDocumentModel: any;
  let fiscalIssuerModel: any;
  let orderModel: any;

  const issuerDoc = {
    _id: 'issuer1',
    nfeSeries: 1,
    toObject: () => ({ _id: 'issuer1', nfeSeries: 1 }),
  };

  beforeEach(async () => {
    const savedDocs: any[] = [];

    fiscalDocumentModel = jest.fn().mockImplementation((data: any) => {
      const doc = {
        _id: `nfe-${savedDocs.length + 1}`,
        ...data,
        save: jest.fn().mockResolvedValue(undefined),
      };
      savedDocs.push(doc);
      return doc;
    });
    fiscalDocumentModel.findOne = jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
    });

    fiscalIssuerModel = {
      findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(issuerDoc) }),
      findOneAndUpdate: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ seriesCounters: { '1': 1 } }) }),
      }),
      findById: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(issuerDoc) }),
    };

    orderModel = {
      findById: jest.fn().mockReturnValue({ findByIdAndUpdate: jest.fn() }),
      findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }) }),
      findByIdAndUpdate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FiscalService,
        { provide: getModelToken(FiscalDocumentModel.name), useValue: fiscalDocumentModel },
        { provide: getModelToken(FiscalIssuerModel.name), useValue: fiscalIssuerModel },
        { provide: getModelToken(OrderModel.name), useValue: orderModel },
        { provide: XmlBuilderService, useValue: { buildNFeXml: jest.fn().mockResolvedValue('<xml/>') } },
        { provide: SignatureService, useValue: { signXml: jest.fn().mockResolvedValue('<xml/>') } },
        { provide: SefazService, useValue: { authorize: jest.fn().mockResolvedValue({ status: 'authorized', protocol: '123' }) } },
        { provide: MarketplaceService, useValue: {} },
        { provide: ProductService, useValue: {} },
        { provide: MarketplaceOrderService, useValue: {} },
        { provide: MarketplaceRegistryService, useValue: {} },
      ],
    }).compile();

    service = module.get<FiscalService>(FiscalService);
  });

  it('grava environment HOMOLOGATION quando orderData.environment = HOMOLOGATION', async () => {
    const orderData = {
      environment: 'HOMOLOGATION',
      buyer: { document: '06726952430', address: { street: 'Rua X', state: 'PE' } },
      items: [{ id: '1', quantity: 1, unit_price: 10 }],
    };

    await service.emitNFe('000000000000000000000001', orderData);

    const createdArg = fiscalDocumentModel.mock.calls[0][0];
    expect(createdArg.environment).toBe('HOMOLOGATION');
  });

  describe('emitNFeAvulsa', () => {
    it('emite NFe sem order vinculado e retorna status/accessKey', async () => {
      const orderData = {
        environment: 'HOMOLOGATION',
        buyer: {
          document: '06726952430',
          name: 'Gustavo Henrique Ferreira Santos',
          address: {
            street: 'Rua Jose Braz Moscow', number: '678', neighborhood: 'Piedade',
            city: 'Jaboatao dos Guararapes', state: 'PE', zipCode: '54410390',
          },
        },
        items: [{ id: 'item-1', title: 'Amortecedor Dianteiro Teste', quantity: 1, unit_price: 150, ncm: '87089990', cfop: '5102', uCom: 'UN' }],
        totals: { amount: 150 },
      };

      const result = await service.emitNFeAvulsa(orderData as any);

      expect(result.status).toBe('AUTHORIZED');
      expect(result.nfeId).toBeDefined();
      const createdArg = fiscalDocumentModel.mock.calls[0][0];
      expect(createdArg.environment).toBe('HOMOLOGATION');
      expect(createdArg.orderId).toBeUndefined();
      expect(createdArg.order).toBeUndefined();
    });

    it('lança erro quando não há issuer ativo configurado', async () => {
      fiscalIssuerModel.findOne = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      const orderData = {
        environment: 'HOMOLOGATION',
        buyer: { document: '06726952430', name: 'X', address: { street: 'A', number: '1', neighborhood: 'B', city: 'C', state: 'PE', zipCode: '00000000' } },
        items: [{ id: '1', title: 'X', quantity: 1, unit_price: 10 }],
        totals: { amount: 10 },
      };

      await expect(service.emitNFeAvulsa(orderData as any)).rejects.toThrow('Nenhum emitente fiscal configurado.');
    });
  });
});
