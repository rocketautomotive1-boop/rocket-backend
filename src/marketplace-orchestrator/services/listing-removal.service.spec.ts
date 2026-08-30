import { ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ListingRemovalService } from './listing-removal.service';

describe('ListingRemovalService.removeListing — roteamento de conta por loja', () => {
  let service: ListingRemovalService;
  let listingModel: { findById: jest.Mock; findByIdAndDelete: jest.Mock; findByIdAndUpdate: jest.Mock; findOneAndUpdate: jest.Mock };
  let configCache: { getById: jest.Mock };
  let auth: { ensureValidToken: jest.Mock };
  let storeService: { resolveAccountId: jest.Mock };
  let orchestratorPublisher: { requestSync: jest.Mock };

  const listingId = new Types.ObjectId().toString();
  const storeId = new Types.ObjectId();
  const marketplaceId = new Types.ObjectId();
  const productId = new Types.ObjectId();
  const accountId = 'ACC_OWNER';

  function makeListing(overrides: any = {}) {
    return {
      _id: listingId,
      productId,
      marketplaceId,
      storeId,
      externalId: 'MLB123',
      title: 'Peça',
      ...overrides,
    };
  }

  beforeEach(() => {
    listingModel = {
      findById: jest.fn(),
      findByIdAndDelete: jest.fn(),
      findByIdAndUpdate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
      findOneAndUpdate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(makeListing()) }),
    };
    configCache = { getById: jest.fn().mockResolvedValue({ _id: marketplaceId, tag: 'mercadolivre', name: 'Mercado Livre', settings: {} }) };
    auth = { ensureValidToken: jest.fn().mockResolvedValue({ accessToken: 'OWNER_AT', refreshToken: 'RT', expiresAt: null, additionalData: {} }) };
    storeService = { resolveAccountId: jest.fn().mockResolvedValue(accountId) };
    orchestratorPublisher = { requestSync: jest.fn().mockResolvedValue(undefined) };

    service = new ListingRemovalService(
      listingModel as any,
      configCache as any,
      auth as any,
      storeService as any,
      orchestratorPublisher as any,
    );
  });

  function mockFindById(listing: any) {
    listingModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(listing) });
  }

  it('lança NotFoundException quando o listing não existe', async () => {
    mockFindById(null);
    await expect(service.removeListing(listingId)).rejects.toThrow(NotFoundException);
  });

  it('deleta direto do banco quando o listing nunca foi publicado (sem externalId)', async () => {
    mockFindById(makeListing({ externalId: undefined }));
    listingModel.findByIdAndDelete.mockReturnValue({ exec: jest.fn().mockResolvedValue({}) });

    const result = await service.removeListing(listingId);

    expect(listingModel.findByIdAndDelete).toHaveBeenCalledWith(listingId);
    expect(result).toEqual({ removed: true });
    expect(storeService.resolveAccountId).not.toHaveBeenCalled();
  });

  it('regressão: resolve accountId via listing.storeId → store.accounts[tag], NÃO via conta ativa', async () => {
    mockFindById(makeListing());

    await service.removeListing(listingId, 'user-1');

    expect(storeService.resolveAccountId).toHaveBeenCalledWith(String(storeId), 'mercadolivre');
    expect(auth.ensureValidToken).toHaveBeenCalledWith(String(marketplaceId), { accountId });
    // NUNCA chama ensureValidToken sem accountId (que cairia na conta ativa/padrão).
    expect(auth.ensureValidToken).not.toHaveBeenCalledWith(String(marketplaceId));
  });

  it('regressão: sem storeId no listing, rejeita explicitamente — não tenta excluir com conta desconhecida', async () => {
    mockFindById(makeListing({ storeId: undefined }));

    await expect(service.removeListing(listingId)).rejects.toThrow(ConflictException);
    expect(storeService.resolveAccountId).not.toHaveBeenCalled();
    expect(auth.ensureValidToken).not.toHaveBeenCalled();
  });

  it('rejeita quando a loja não tem conta configurada para o marketplace', async () => {
    mockFindById(makeListing());
    storeService.resolveAccountId.mockResolvedValue(null);

    await expect(service.removeListing(listingId)).rejects.toThrow(ConflictException);
    expect(auth.ensureValidToken).not.toHaveBeenCalled();
  });

  it('despacha o DELETE via OrchestratorPublisherService (fila de sync que o worker realmente consome)', async () => {
    mockFindById(makeListing());

    const result = await service.removeListing(listingId, 'user-1');

    expect(orchestratorPublisher.requestSync).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: String(productId),
        action: 'DELETE',
        targetMarketplaceIds: [String(marketplaceId)],
        requesterId: 'user-1',
      }),
    );
    expect(result.queued).toBe(true);
  });

  it('propaga moderationDelete:true quando informado (exclusão via moderação, elegível a reentrar quando o produto ficar ready)', async () => {
    mockFindById(makeListing());

    await service.removeListing(listingId, 'user-1', { moderationDelete: true });

    expect(orchestratorPublisher.requestSync).toHaveBeenCalledWith(
      expect.objectContaining({ moderationDelete: true }),
    );
  });

  it('exclusão manual (sem moderationDelete) não propaga a flag', async () => {
    mockFindById(makeListing());

    await service.removeListing(listingId, 'user-1');

    const call = orchestratorPublisher.requestSync.mock.calls[0][0];
    expect(call.moderationDelete).toBeUndefined();
  });

  it('sem token válido para a conta dona, marca removido localmente com aviso (não usa outra conta como fallback)', async () => {
    mockFindById(makeListing());
    auth.ensureValidToken.mockResolvedValue(null);

    const result = await service.removeListing(listingId);

    expect(listingModel.findByIdAndUpdate).toHaveBeenCalledWith(listingId, {
      $set: { status: 'removed', publishingAt: null },
    });
    expect(result.removed).toBe(true);
    expect(result.warning).toMatch(/ACC_OWNER/);
    expect(orchestratorPublisher.requestSync).not.toHaveBeenCalled();
  });
});
