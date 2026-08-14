import { TokenManagerService } from './token-manager.service';

describe('TokenManagerService.forceRefresh', () => {
  const makeService = (broker: any) => {
    const modelStub: any = {};
    const service = new TokenManagerService(modelStub, broker);
    jest.spyOn(service, 'resolveToken').mockResolvedValue({ accessToken: 'NEW' } as any);
    return service;
  };

  it('refreshes the account matching the given accountId, not the domain default', async () => {
    const broker = {
      accountById: jest.fn(async () => ({ accountId: 'ACC_B' })),
      accountFor: jest.fn(async () => ({ accountId: 'ACC_DEFAULT' })),
      refreshToken: jest.fn(async () => undefined),
    };
    const service = makeService(broker);

    await service.forceRefresh('MKT1', { accountId: 'ACC_B' });

    expect(broker.accountById).toHaveBeenCalledWith('MKT1', 'ACC_B');
    expect(broker.refreshToken).toHaveBeenCalledWith('MKT1', 'ACC_B', undefined);
    expect(broker.accountFor).not.toHaveBeenCalled();
  });

  it('falls back to domain resolution when no accountId given (legacy positional string)', async () => {
    const broker = {
      accountById: jest.fn(),
      accountFor: jest.fn(async () => ({ accountId: 'ACC_DEFAULT' })),
      refreshToken: jest.fn(async () => undefined),
    };
    const service = makeService(broker);

    await service.forceRefresh('MKT1', 'autopecas');

    expect(broker.accountFor).toHaveBeenCalledWith('MKT1', 'autopecas');
    expect(broker.refreshToken).toHaveBeenCalledWith('MKT1', 'ACC_DEFAULT', 'autopecas');
    expect(broker.accountById).not.toHaveBeenCalled();
  });
});
