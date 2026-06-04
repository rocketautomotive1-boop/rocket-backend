import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MarketplaceAccountAuthController } from './marketplace-account-auth.controller';

describe('MarketplaceAccountAuthController.createAccount', () => {
  const makeController = (overrides: { registry?: any; accountService?: any } = {}) => {
    const accountService = {
      registerAccount: jest.fn().mockResolvedValue({ _id: 'acc1', label: 'General', domains: ['general'] }),
      buildAuthUrl: jest.fn().mockResolvedValue({ authUrl: 'https://auth.ml/x' }),
      ...overrides.accountService,
    };
    const registry = {
      findByTag: jest.fn().mockResolvedValue({ _id: 'mp1' }),
      ...overrides.registry,
    };
    const config = { get: jest.fn().mockReturnValue('https://api.test') };
    const controller = new MarketplaceAccountAuthController(accountService as any, registry as any, config as any);
    return { controller, accountService, registry };
  };

  const validBody = { label: 'General', domains: ['general'], clientId: 'CID', clientSecret: 'CSECRET' };

  it('creates the account, encrypts via service, and returns accountId + authUrl', async () => {
    const { controller, accountService, registry } = makeController();
    const res = await controller.createAccount('mercadolivre', validBody);

    expect(registry.findByTag).toHaveBeenCalledWith('mercadolivre');
    expect(accountService.registerAccount).toHaveBeenCalledWith({
      marketplaceId: 'mp1',
      label: 'General',
      domains: ['general'],
      credentials: { clientId: 'CID', clientSecret: 'CSECRET' },
    });
    expect(res).toEqual({
      accountId: 'acc1',
      label: 'General',
      domains: ['general'],
      authUrl: 'https://auth.ml/x',
    });
  });

  it('rejects missing label / domains / credentials', async () => {
    const { controller } = makeController();
    await expect(controller.createAccount('mercadolivre', { ...validBody, label: '' })).rejects.toThrow(BadRequestException);
    await expect(controller.createAccount('mercadolivre', { ...validBody, domains: [] })).rejects.toThrow(BadRequestException);
    await expect(controller.createAccount('mercadolivre', { ...validBody, clientSecret: '' })).rejects.toThrow(BadRequestException);
  });

  it('404s when the marketplace tag is unknown', async () => {
    const { controller } = makeController({ registry: { findByTag: jest.fn().mockResolvedValue(null) } });
    await expect(controller.createAccount('nope', validBody)).rejects.toThrow(NotFoundException);
  });
});
