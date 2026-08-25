import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FiscalService } from './fiscal.service';
import { FiscalDocumentModel, FiscalInutilizationModel } from '../schemas/fiscal.schema';
import { XmlBuilderService } from './xml-builder.service';
import { SignatureService } from './signature.service';
import { SefazService } from './sefaz.service';
import { ProductService } from '../../product/product.service';
import { MarketplaceService } from '../../marketplace/services/marketplace.service';
import { MarketplaceOrderService } from '../../marketplace/services/marketplace-order.service';
import { MarketplaceRegistryService } from '../../marketplace/services/marketplace-registry.service';
import { OrderModel } from '../../order/schemas/order.schema';
import { STORE_PORT, StorePort } from '../../store/ports/store.port';
import { LegalEntityService } from '../../legal-entity/services/legal-entity.service';
import { FiscalCustomerService } from '../../fiscal-customer/services/fiscal-customer.service';
import { FISCAL_EVENTS } from '../events/fiscal.events';

describe('FiscalService — environment on new NFe', () => {
  let service: FiscalService;
  let fiscalDocumentModel: any;
  let orderModel: any;
  let storePort: jest.Mocked<StorePort>;
  let legalEntityService: { findById: jest.Mock; findActive: jest.Mock };

  let legalEntityDoc: any;
  const freshLegalEntityDoc = () => ({
    _id: 'legal1',
    cnpj: '00000000000191',
    contingencyMode: false,
    contingencyConsecutiveFailures: 0,
    contingencySuccessCount: 0,
    toObject: () => ({ _id: 'legal1', cnpj: '00000000000191' }),
  });

  const storeDoc = { id: '000000000000000000000010', name: 'Loja Matriz', legalEntityId: 'legal1' };
  const channelDoc = { marketplaceTag: 'mercado_livre', accountId: 'acc1', series: 1, counter: 0 };

  const dbOrderBase = {
    _id: '000000000000000000000001',
    externalId: 'MLB-1',
    marketplaceId: 'mp1',
    marketplaceTag: 'mercado_livre',
    accountId: 'acc1',
    items: [],
    totalAmount: 0,
    shippingAmount: 0,
  };

  beforeEach(async () => {
    legalEntityDoc = freshLegalEntityDoc();
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

    orderModel = {
      findById: jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(dbOrderBase) }) }),
      }),
      findOne: jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }) }),
        lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
      }),
      findByIdAndUpdate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
    };

    storePort = {
      findById: jest.fn().mockResolvedValue(storeDoc),
      findByName: jest.fn(),
      resolveAccountId: jest.fn(),
      resolveAccountIds: jest.fn(),
      resolveStoreForAccount: jest.fn().mockResolvedValue(storeDoc),
      resolveFiscalChannel: jest.fn().mockResolvedValue(channelDoc),
      reserveFiscalNumber: jest.fn().mockResolvedValue({ series: 1, number: 1 }),
    } as any;

    legalEntityService = {
      findById: jest.fn().mockResolvedValue(legalEntityDoc),
      findActive: jest.fn().mockResolvedValue(legalEntityDoc),
      updateContingencyState: jest.fn().mockImplementation((_id: string, data: any) => {
        Object.assign(legalEntityDoc, data);
        return Promise.resolve({ ...legalEntityDoc });
      }),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FiscalService,
        { provide: getModelToken(FiscalDocumentModel.name), useValue: fiscalDocumentModel },
        { provide: getModelToken(FiscalInutilizationModel.name), useValue: { create: jest.fn().mockResolvedValue(undefined) } },
        { provide: getModelToken(OrderModel.name), useValue: orderModel },
        { provide: XmlBuilderService, useValue: { buildNFeXml: jest.fn().mockResolvedValue('<xml/>') } },
        { provide: SignatureService, useValue: { signXml: jest.fn().mockResolvedValue('<xml/>') } },
        { provide: SefazService, useValue: { authorize: jest.fn().mockResolvedValue({ status: 'authorized', protocol: '123' }) } },
        { provide: MarketplaceService, useValue: {} },
        { provide: ProductService, useValue: {} },
        { provide: MarketplaceOrderService, useValue: {} },
        { provide: MarketplaceRegistryService, useValue: {} },
        { provide: STORE_PORT, useValue: storePort },
        { provide: LegalEntityService, useValue: legalEntityService },
        { provide: FiscalCustomerService, useValue: { findByDocument: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue(undefined) } },
        EventEmitter2,
      ],
    }).compile();

    service = module.get<FiscalService>(FiscalService);
  });

  it('grava environment HOMOLOGATION quando orderData.environment = HOMOLOGATION', async () => {
    const orderData = {
      environment: 'HOMOLOGATION',
      marketplaceTag: 'mercado_livre',
      accountId: 'acc1',
      buyer: { document: '06726952430', address: { street: 'Rua X', state: 'PE' } },
      items: [{ id: '1', quantity: 1, unit_price: 10 }],
    };

    await service.emitNFe('000000000000000000000001', orderData);

    const createdArg = fiscalDocumentModel.mock.calls[0][0];
    expect(createdArg.environment).toBe('HOMOLOGATION');
    expect(storePort.resolveStoreForAccount).toHaveBeenCalledWith('mercado_livre', 'acc1');
    expect(storePort.reserveFiscalNumber).toHaveBeenCalledWith('000000000000000000000010', 'mercado_livre', 'acc1');
  });

  it('emite FISCAL_EVENTS.NFE_AUTHORIZED quando a NFe é autorizada', async () => {
    const emitter = service['eventEmitter'] as EventEmitter2;
    const listener = jest.fn();
    emitter.on(FISCAL_EVENTS.NFE_AUTHORIZED, listener);

    const orderData = {
      environment: 'HOMOLOGATION',
      marketplaceTag: 'mercado_livre',
      accountId: 'acc1',
      buyer: { document: '06726952430', address: { street: 'Rua X', state: 'PE' } },
      items: [{ id: '1', quantity: 1, unit_price: 10 }],
    };

    await service.emitNFe('000000000000000000000001', orderData);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toMatchObject({ series: 1, number: 1 });
  });

  it('persiste FiscalDocument em ERROR e emite FISCAL_EVENTS.NFE_ERROR quando resolveFiscalContext falha (ex: loja sem canal fiscal) — antes essa falha ocorria fora do try/catch e nunca criava documento nem notificava, deixando a modal do app travada para sempre', async () => {
    const emitter = service['eventEmitter'] as EventEmitter2;
    const listener = jest.fn();
    emitter.on(FISCAL_EVENTS.NFE_ERROR, listener);

    storePort.resolveFiscalChannel.mockResolvedValueOnce(null);

    const orderData = {
      environment: 'HOMOLOGATION',
      marketplaceTag: 'mercado_livre',
      accountId: 'acc1',
      buyer: { document: '06726952430', address: { street: 'Rua X', state: 'PE' } },
      items: [{ id: '1', quantity: 1, unit_price: 10 }],
    };

    await expect(service.emitNFe('000000000000000000000001', orderData)).rejects.toThrow(/não tem canal fiscal configurado/);

    // FiscalDocument criado e persistido em ERROR, mesmo sem store/issuer/série resolvidos
    const createdArg = fiscalDocumentModel.mock.calls[0][0];
    expect(createdArg.status).toBe('DRAFT');
    const savedDoc = fiscalDocumentModel.mock.results[0].value;
    expect(savedDoc.status).toBe('ERROR');
    expect(savedDoc.rejectionReason).toMatch(/não tem canal fiscal configurado/);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toMatchObject({
      orderId: '000000000000000000000001',
      message: expect.stringMatching(/não tem canal fiscal configurado/),
    });
  });

  it('emite FISCAL_EVENTS.NFE_ERROR quando a transmissão falha (fora do fluxo de contingência)', async () => {
    const emitter = service['eventEmitter'] as EventEmitter2;
    const listener = jest.fn();
    emitter.on(FISCAL_EVENTS.NFE_ERROR, listener);

    const sefazService = (service as any).sefazService;
    sefazService.authorize = jest.fn().mockRejectedValue(new Error('Certificado expirado'));

    const orderData = {
      environment: 'HOMOLOGATION',
      marketplaceTag: 'mercado_livre',
      accountId: 'acc1',
      buyer: { document: '06726952430', address: { street: 'Rua X', state: 'PE' } },
      items: [{ id: '1', quantity: 1, unit_price: 10 }],
    };

    await expect(service.emitNFe('000000000000000000000001', orderData)).rejects.toThrow('Certificado expirado');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toMatchObject({
      orderId: '000000000000000000000001',
      message: 'Certificado expirado',
    });
  });

  it('lança erro quando a conta não tem loja vinculada', async () => {
    storePort.resolveStoreForAccount.mockResolvedValueOnce(null);

    const orderData = {
      environment: 'HOMOLOGATION',
      marketplaceTag: 'mercado_livre',
      accountId: 'acc1',
      buyer: { document: '06726952430', address: { street: 'Rua X', state: 'PE' } },
      items: [{ id: '1', quantity: 1, unit_price: 10 }],
    };

    await expect(service.emitNFe('000000000000000000000001', orderData)).rejects.toThrow(
      /Nenhuma loja vinculada/,
    );
  });

  describe('emitNFeAvulsa', () => {
    const validOrderData = {
      environment: 'HOMOLOGATION' as const,
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
      storeId: '000000000000000000000010',
      marketplaceTag: 'mercado_livre',
      accountId: 'acc1',
    };

    it('emite NFe sem order vinculado e retorna status/accessKey', async () => {
      const result = await service.emitNFeAvulsa(validOrderData as any);

      expect(result.status).toBe('AUTHORIZED');
      expect(result.nfeId).toBeDefined();
      const createdArg = fiscalDocumentModel.mock.calls[0][0];
      expect(createdArg.environment).toBe('HOMOLOGATION');
      expect(createdArg.orderId).toBeUndefined();
      expect(createdArg.order).toBeUndefined();
      expect(String(createdArg.storeId)).toBe('000000000000000000000010');
    });

    it('lança erro quando storeId/marketplaceTag/accountId ausentes', async () => {
      const { storeId, ...rest } = validOrderData;
      await expect(service.emitNFeAvulsa(rest as any)).rejects.toThrow(
        /storeId\/marketplaceTag\/accountId são obrigatórios/,
      );
    });

    it('lança erro quando a loja não tem canal fiscal configurado', async () => {
      storePort.resolveFiscalChannel.mockResolvedValueOnce(null);
      await expect(service.emitNFeAvulsa(validOrderData as any)).rejects.toThrow(
        /não tem canal fiscal configurado/,
      );
    });
  });

  describe('correctNFe (CC-e)', () => {
    const authorizedNfe = {
      _id: 'nfe-authorized',
      status: 'AUTHORIZED',
      storeId: '000000000000000000000010',
      accessKey: 'CHAVE123',
      environment: 'HOMOLOGATION',
      cceEvents: [],
      save: jest.fn().mockResolvedValue(undefined),
    };

    let sefazService: { correctNFe: jest.Mock };

    beforeEach(() => {
      fiscalDocumentModel.findOne = jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ ...authorizedNfe, cceEvents: [] }) }),
      });
      sefazService = (service as any).sefazService;
      sefazService.correctNFe = jest.fn().mockResolvedValue({ status: 'registered', protocol: 'prot-1', message: 'Evento registrado' });
    });

    it('emite CC-e com sequência 1 na primeira correção', async () => {
      const result = await service.correctNFe('000000000000000000000001', 'Corrigir o complemento do endereço de entrega.');

      expect(result.sequence).toBe(1);
      expect(sefazService.correctNFe).toHaveBeenCalledWith(
        expect.objectContaining({ accessKey: 'CHAVE123' }),
        legalEntityDoc,
        'Corrigir o complemento do endereço de entrega.',
        1,
      );
    });

    it('rejeita texto de correção abaixo do mínimo de 15 caracteres', async () => {
      await expect(service.correctNFe('000000000000000000000001', 'muito curto')).rejects.toThrow(
        /mínimo de 15 caracteres|no mínimo 15/,
      );
    });

    it('lança erro quando não há NFe autorizada para o pedido', async () => {
      fiscalDocumentModel.findOne = jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
      });
      await expect(
        service.correctNFe('000000000000000000000001', 'Corrigir o complemento do endereço.'),
      ).rejects.toThrow(/não encontrada/);
    });
  });

  describe('inutilizeRange', () => {
    let sefazService: { inutilizeRange: jest.Mock };

    beforeEach(() => {
      sefazService = (service as any).sefazService;
      sefazService.inutilizeRange = jest.fn().mockResolvedValue({ status: 'authorized', protocol: 'prot-2', message: 'Inutilização homologada' });
    });

    it('inutiliza a faixa e persiste o registro', async () => {
      const result = await service.inutilizeRange({
        storeId: '000000000000000000000010',
        series: 2,
        from: 10,
        to: 15,
        justification: 'Números pulados por falha de sistema em teste.',
      });

      expect(result.status).toBe('authorized');
    });

    it('rejeita from > to', async () => {
      await expect(service.inutilizeRange({
        storeId: '000000000000000000000010',
        series: 2, from: 20, to: 10,
        justification: 'Números pulados por falha de sistema em teste.',
      })).rejects.toThrow(/não pode ser maior/);
    });

    it('rejeita justificativa abaixo do mínimo', async () => {
      await expect(service.inutilizeRange({
        storeId: '000000000000000000000010',
        series: 2, from: 10, to: 15,
        justification: 'curta',
      })).rejects.toThrow(/mínimo/);
    });
  });

  describe('EPEC (contingência)', () => {
    let sefazService: { authorize: jest.Mock; transmitEpec: jest.Mock };
    const orderData = {
      environment: 'PRODUCTION',
      marketplaceTag: 'mercado_livre',
      accountId: 'acc1',
      buyer: { document: '06726952430', address: { street: 'Rua X', state: 'PE' } },
      items: [{ id: '1', quantity: 1, unit_price: 10 }],
    };

    beforeEach(() => {
      sefazService = (service as any).sefazService;
    });

    it('em operação normal, não entra em contingência mesmo após uma falha isolada', async () => {
      sefazService.authorize = jest.fn().mockRejectedValueOnce(new Error('ETIMEDOUT'));

      await expect(service.emitNFe('000000000000000000000001', orderData)).rejects.toThrow('ETIMEDOUT');
      expect(legalEntityDoc.contingencyMode).toBe(false);
      expect(legalEntityDoc.contingencyConsecutiveFailures).toBe(1);
    });

    it('ativa contingencyMode após N falhas de transporte consecutivas e transmite via EPEC', async () => {
      sefazService.authorize = jest.fn().mockRejectedValue(new Error('ETIMEDOUT'));
      sefazService.transmitEpec = jest.fn().mockResolvedValue({ status: 'authorized_contingency', protocol: 'epec-1', message: 'OK' });

      // FISCAL_TRANSPORT_FAILURE_THRESHOLD default = 3
      await expect(service.emitNFe('000000000000000000000001', orderData)).rejects.toThrow();
      await expect(service.emitNFe('000000000000000000000001', orderData)).rejects.toThrow();
      const result = await service.emitNFe('000000000000000000000001', orderData);

      expect(legalEntityDoc.contingencyMode).toBe(true);
      expect(sefazService.transmitEpec).toHaveBeenCalledTimes(1);
      expect(result.status).toBe('AUTHORIZED_CONTINGENCY');
    });

    it('zera o contador de falhas após uma transmissão normal bem-sucedida', async () => {
      sefazService.authorize = jest.fn()
        .mockRejectedValueOnce(new Error('ETIMEDOUT'))
        .mockResolvedValueOnce({ status: 'authorized', protocol: '123' });

      await expect(service.emitNFe('000000000000000000000001', orderData)).rejects.toThrow();
      expect(legalEntityDoc.contingencyConsecutiveFailures).toBe(1);

      await service.emitNFe('000000000000000000000001', orderData);
      expect(legalEntityDoc.contingencyConsecutiveFailures).toBe(0);
    });

    it('quando já está em contingência, transmite direto via EPEC sem tentar authorize()', async () => {
      legalEntityDoc.contingencyMode = true;
      sefazService.authorize = jest.fn();
      sefazService.transmitEpec = jest.fn().mockResolvedValue({ status: 'authorized_contingency', protocol: 'epec-2', message: 'OK' });

      const result = await service.emitNFe('000000000000000000000001', orderData);

      expect(sefazService.authorize).not.toHaveBeenCalled();
      expect(sefazService.transmitEpec).toHaveBeenCalledTimes(1);
      expect(result.status).toBe('AUTHORIZED_CONTINGENCY');
    });
  });
});
