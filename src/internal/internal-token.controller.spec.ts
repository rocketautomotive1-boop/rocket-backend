import { NotFoundException } from '@nestjs/common';
import { InternalTokenController } from './internal-token.controller';

describe('InternalTokenController.isPublishingDisabled', () => {
  let controller: InternalTokenController;
  let authService: { isPublishingDisabled: jest.Mock };
  let registry: { findByTag: jest.Mock };

  beforeEach(() => {
    authService = { isPublishingDisabled: jest.fn() };
    registry = { findByTag: jest.fn() };
    controller = new InternalTokenController(authService as any, registry as any);
  });

  it('retorna { disabled: true } quando não há conta ativa para o marketplace', async () => {
    registry.findByTag.mockResolvedValue({ _id: 'mp1' });
    authService.isPublishingDisabled.mockResolvedValue(true);

    const result = await controller.isPublishingDisabled('mercadolivre');

    expect(authService.isPublishingDisabled).toHaveBeenCalledWith('mp1');
    expect(result).toEqual({ disabled: true });
  });

  it('retorna { disabled: false } quando há conta ativa', async () => {
    registry.findByTag.mockResolvedValue({ _id: 'mp1' });
    authService.isPublishingDisabled.mockResolvedValue(false);

    const result = await controller.isPublishingDisabled('mercadolivre');

    expect(result).toEqual({ disabled: false });
  });

  it('lança NotFoundException para marketplace inexistente', async () => {
    registry.findByTag.mockResolvedValue(null);

    await expect(controller.isPublishingDisabled('inexistente')).rejects.toThrow(NotFoundException);
  });
});
