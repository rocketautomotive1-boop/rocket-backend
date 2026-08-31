import { Types } from 'mongoose';
import { ProductService } from './product.service';

/**
 * POST /items/{id}/compatibilities é ADITIVO (confirmado ao vivo contra a API: chamadas
 * separadas ou um único payload com N produtos apenas acrescentam, nunca substituem), mas
 * tem teto rígido de 200 produtos por requisição (confirmado ao vivo: 201 numa chamada só
 * dá 400 "Maximum of 200 products for a single request was exceeded"). O chunking antigo de
 * 50 em 50 era desnecessário (mais chamadas de rede que o limite real exige); o correto é
 * chunk de até 200 — o mínimo de chamadas que respeita o teto da API.
 */
describe('ProductService — sync de compatibilidades com Mercado Livre (chunking)', () => {
  let service: ProductService;
  let productCompatibilityService: {
    createMultipleCompatibilitiesBatch: jest.Mock;
    markAsSynced: jest.Mock;
  };
  let marketplaceRegistry: { findByName: jest.Mock };
  let productTitleService: { findByProductId: jest.Mock };
  let mercadoLivreCompatibilityAdapter: { syncCompatibility: jest.Mock };
  let productRepository: { findByIdClean: jest.Mock; findOne: jest.Mock };
  let existingProduct: any;

  beforeEach(() => {
    existingProduct = { _id: new Types.ObjectId(), name: 'Produto teste' };

    productRepository = {
      findOne: jest.fn().mockResolvedValue(existingProduct),
      findByIdClean: jest.fn().mockResolvedValue(existingProduct),
    };

    // 201 veículos -> excede o antigo chunkSize de 50
    const vehicleIds = Array.from({ length: 201 }, (_, i) => `v${i}`);
    const savedCompatibilities = vehicleIds.map((vehicleId, i) => ({
      _id: new Types.ObjectId(),
      vehicleId,
      mlVehicleId: `ml-${i}`,
    }));

    productCompatibilityService = {
      createMultipleCompatibilitiesBatch: jest.fn().mockResolvedValue(savedCompatibilities),
      markAsSynced: jest.fn().mockResolvedValue(undefined),
    };

    marketplaceRegistry = {
      findByName: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
    };

    productTitleService = {
      findByProductId: jest.fn().mockResolvedValue([
        { marketplaceId: String((marketplaceRegistry.findByName.mock as any).results?.[0]?.value?._id ?? ''), externalId: 'MLB123', title: 'Item' },
      ]),
    };

    mercadoLivreCompatibilityAdapter = {
      syncCompatibility: jest.fn().mockResolvedValue({ ok: true }),
    };

    const noop: any = {};
    const storePort: any = { resolveAccountId: jest.fn().mockResolvedValue(null) };

    service = new ProductService(
      productRepository as any,
      noop, // STOCK_QUERY_PORT
      noop, // STORE_AWARE_STOCK_QUERY_PORT
      noop, // STORE_OWNER_LOOKUP_PORT
      storePort, // STORE_PORT
      noop, // PRICING_PORT
      noop, // queueService
      productCompatibilityService as any,
      noop, // productFilterService
      marketplaceRegistry as any,
      noop, // stockService
      noop, // marketplaceDescriptionService
      noop, // publicationLogService
      noop, // categoryMappingService
      productTitleService as any,
      noop, // userProductivityService
      noop, // productCategoryService
      noop, // titleCategoryHintService
      noop, // productShortTitleService
      mercadoLivreCompatibilityAdapter as any,
      noop, // brandModel
      noop, // productDiscoveryModel
      { emit: jest.fn() } as any, // eventEmitter
      noop, // productReadinessService
      { requestSync: jest.fn().mockResolvedValue(undefined) } as any, // orchestratorPublisher
    );

    // productTitleService precisa retornar o marketplaceId real resolvido acima
    const resolvedMarketplace = marketplaceRegistry.findByName.getMockImplementation();
  });

  it('envia veículos em chunks de até 200 (teto da API), não de 50', async () => {
    const marketplaceDoc = { _id: new Types.ObjectId() };
    marketplaceRegistry.findByName.mockResolvedValue(marketplaceDoc);
    productTitleService.findByProductId.mockResolvedValue([
      { marketplaceId: String(marketplaceDoc._id), externalId: 'MLB123', title: 'Item' },
    ]);

    const vehicleIds = Array.from({ length: 201 }, (_, i) => `v${i}`);

    await service.addProductCompatibilities(String(existingProduct._id), vehicleIds);

    expect(mercadoLivreCompatibilityAdapter.syncCompatibility).toHaveBeenCalledTimes(2);

    const [, firstPayload] = mercadoLivreCompatibilityAdapter.syncCompatibility.mock.calls[0];
    const [, secondPayload] = mercadoLivreCompatibilityAdapter.syncCompatibility.mock.calls[1];
    expect(firstPayload.products).toHaveLength(200);
    expect(secondPayload.products).toHaveLength(1);
  });

  it('envia numa única chamada quando há 200 veículos ou menos', async () => {
    const marketplaceDoc = { _id: new Types.ObjectId() };
    marketplaceRegistry.findByName.mockResolvedValue(marketplaceDoc);
    productTitleService.findByProductId.mockResolvedValue([
      { marketplaceId: String(marketplaceDoc._id), externalId: 'MLB123', title: 'Item' },
    ]);
    productCompatibilityService.createMultipleCompatibilitiesBatch.mockResolvedValue(
      Array.from({ length: 200 }, (_, i) => ({ _id: new Types.ObjectId(), vehicleId: `v${i}`, mlVehicleId: `ml-${i}` })),
    );

    const vehicleIds = Array.from({ length: 200 }, (_, i) => `v${i}`);

    await service.addProductCompatibilities(String(existingProduct._id), vehicleIds);

    expect(mercadoLivreCompatibilityAdapter.syncCompatibility).toHaveBeenCalledTimes(1);
    const [, payload] = mercadoLivreCompatibilityAdapter.syncCompatibility.mock.calls[0];
    expect(payload.products).toHaveLength(200);
  });

  it('desativa isUniversalFit automaticamente ao adicionar compatibilidade a um produto universal', async () => {
    existingProduct.isUniversalFit = true;
    (productRepository as any).update = jest.fn().mockResolvedValue(existingProduct);

    await service.addProductCompatibilities(String(existingProduct._id), ['v1']);

    expect((productRepository as any).update).toHaveBeenCalledWith(
      String(existingProduct._id),
      { $set: { isUniversalFit: false } },
    );
  });

  it('não mexe em isUniversalFit quando o produto já não é universal', async () => {
    existingProduct.isUniversalFit = false;
    (productRepository as any).update = jest.fn().mockResolvedValue(existingProduct);

    await service.addProductCompatibilities(String(existingProduct._id), ['v1']);

    expect((productRepository as any).update).not.toHaveBeenCalled();
  });
});

/**
 * Reproduz bug: remover uma compatibilidade só apagava localmente. O caminho antigo
 * enfileirava um evento RabbitMQ ('product.sync_compatibilities') que nenhum consumer
 * escutava de fato (@MessagePattern registrado era 'product-sync-compatibilities', com
 * hífen) — a mensagem nunca era entregue, e removeCompatibilityFromMarketplace (DELETE
 * no adapter) nunca tinha caller nenhum. Fix: chamar o adapter direto, sem fila.
 */
describe('ProductService — remoção de compatibilidade propaga pro Mercado Livre', () => {
  let service: ProductService;
  let productCompatibilityService: {
    deleteCompatibility: jest.Mock;
    deleteMultipleCompatibilities: jest.Mock;
  };
  let marketplaceRegistry: { findByName: jest.Mock };
  let productTitleService: { findByProductId: jest.Mock };
  let mercadoLivreCompatibilityAdapter: { removeCompatibilityFromMarketplace: jest.Mock };
  let queueService: { addToQueue: jest.Mock };
  let productRepository: { findByIdClean: jest.Mock; findOne: jest.Mock };
  let existingProduct: any;
  let marketplaceDoc: any;

  beforeEach(() => {
    existingProduct = { _id: new Types.ObjectId(), name: 'Produto teste' };
    marketplaceDoc = { _id: new Types.ObjectId() };

    productRepository = {
      findOne: jest.fn().mockResolvedValue(existingProduct),
      findByIdClean: jest.fn().mockResolvedValue(existingProduct),
    };

    productCompatibilityService = {
      deleteCompatibility: jest.fn().mockResolvedValue({ _id: new Types.ObjectId(), vehicleId: 'v1', mlVehicleId: 'MLB999' }),
      deleteMultipleCompatibilities: jest.fn().mockResolvedValue([
        { _id: new Types.ObjectId(), vehicleId: 'v1', mlVehicleId: 'MLB999' },
        { _id: new Types.ObjectId(), vehicleId: 'v2', mlVehicleId: 'MLB998' },
      ]),
    };

    marketplaceRegistry = { findByName: jest.fn().mockResolvedValue(marketplaceDoc) };

    productTitleService = {
      findByProductId: jest.fn().mockResolvedValue([
        { marketplaceId: String(marketplaceDoc._id), externalId: 'MLB123', title: 'Item' },
      ]),
    };

    mercadoLivreCompatibilityAdapter = {
      removeCompatibilityFromMarketplace: jest.fn().mockResolvedValue({ removed: true }),
    };

    queueService = { addToQueue: jest.fn() };

    const noop: any = {};
    const storePort: any = { resolveAccountId: jest.fn().mockResolvedValue(null) };

    service = new ProductService(
      productRepository as any,
      noop, // STOCK_QUERY_PORT
      noop, // STORE_AWARE_STOCK_QUERY_PORT
      noop, // STORE_OWNER_LOOKUP_PORT
      storePort, // STORE_PORT
      noop, // PRICING_PORT
      queueService as any,
      productCompatibilityService as any,
      noop, // productFilterService
      marketplaceRegistry as any,
      noop, // stockService
      noop, // marketplaceDescriptionService
      noop, // publicationLogService
      noop, // categoryMappingService
      productTitleService as any,
      noop, // userProductivityService
      noop, // productCategoryService
      noop, // titleCategoryHintService
      noop, // productShortTitleService
      mercadoLivreCompatibilityAdapter as any,
      noop, // brandModel
      noop, // productDiscoveryModel
      { emit: jest.fn() } as any, // eventEmitter
      noop, // productReadinessService
      { requestSync: jest.fn().mockResolvedValue(undefined) } as any, // orchestratorPublisher
    );
  });

  it('removeProductCompatibility chama o adapter direto (sem fila) com o mlVehicleId removido', async () => {
    await service.removeProductCompatibility(String(existingProduct._id), 'compat-id-1');

    expect(mercadoLivreCompatibilityAdapter.removeCompatibilityFromMarketplace).toHaveBeenCalledWith('MLB123', 'MLB999', undefined);
    expect(queueService.addToQueue).not.toHaveBeenCalled();
  });

  it('removeProductCompatibilities chama o adapter uma vez por veículo removido em lote', async () => {
    await service.removeProductCompatibilities(String(existingProduct._id), ['compat-id-1', 'compat-id-2']);

    expect(mercadoLivreCompatibilityAdapter.removeCompatibilityFromMarketplace).toHaveBeenCalledWith('MLB123', 'MLB999', undefined);
    expect(mercadoLivreCompatibilityAdapter.removeCompatibilityFromMarketplace).toHaveBeenCalledWith('MLB123', 'MLB998', undefined);
    expect(queueService.addToQueue).not.toHaveBeenCalled();
  });

  it('removeProductCompatibility não lança quando a remoção no ML falha (best-effort)', async () => {
    mercadoLivreCompatibilityAdapter.removeCompatibilityFromMarketplace.mockRejectedValue(new Error('ML fora do ar'));

    await expect(
      service.removeProductCompatibility(String(existingProduct._id), 'compat-id-1'),
    ).resolves.toBeUndefined();
  });
});
