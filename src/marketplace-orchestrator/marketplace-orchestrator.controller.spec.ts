import { BadRequestException } from '@nestjs/common';
import { MarketplaceOrchestratorController } from './marketplace-orchestrator.controller';

describe('MarketplaceOrchestratorController', () => {
  let controller: MarketplaceOrchestratorController;
  let publicationFlowService: { listIssues: jest.Mock };

  beforeEach(() => {
    publicationFlowService = { listIssues: jest.fn().mockResolvedValue({ items: [], total: 0 }) };
    controller = new MarketplaceOrchestratorController(publicationFlowService as any);
  });

  describe('listIssues', () => {
    it('resolves storeId from req.user.storeId — never from the client', async () => {
      const req = { user: { storeId: 'store-maxeshop' } };

      await controller.listIssues(req as any);

      expect(publicationFlowService.listIssues).toHaveBeenCalledWith(
        expect.objectContaining({ storeId: 'store-maxeshop' }),
      );
    });

    it('rejects with 400 when the authenticated user has no storeId', async () => {
      const req = { user: { storeId: null } };

      await expect(controller.listIssues(req as any)).rejects.toThrow(BadRequestException);
      expect(publicationFlowService.listIssues).not.toHaveBeenCalled();
    });
  });
});
