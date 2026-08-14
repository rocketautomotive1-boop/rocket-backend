import { MarketplaceController } from './marketplace.controller';

/**
 * Regressão: @Param('productId') productId: number (sem ParseIntPipe) combinado com o
 * ValidationPipe global (transform:true) convertia o ObjectId hex em Number, virando NaN —
 * toda publicação manual (botão "Publicar" do app, via POST /marketplaces/products/:id/publish)
 * enfileirava um sync.requested com productId:'NaN', que o orchestrator rejeitava (500) em loop
 * até esgotar tentativas e cair na DLQ. productId agora é string — o ValidationPipe não tenta
 * convertê-lo.
 */
describe('MarketplaceController.publishProduct', () => {
  it('propaga o productId (ObjectId hex) intacto para requestSync, sem convertê-lo pra Number', async () => {
    const requestSync = jest.fn();
    const controller = Object.create(MarketplaceController.prototype) as MarketplaceController;
    (controller as any).orchestratorPublisherService = { requestSync };

    const productId = '69ab6a933426e74c0c32bc70';
    const req = { user: { sub: 'user-1' } } as any;

    const result = await controller.publishProduct(productId, req);

    expect(requestSync).toHaveBeenCalledWith(
      expect.objectContaining({ productId: '69ab6a933426e74c0c32bc70', reason: 'user_publish', requesterId: 'user-1' }),
    );
    expect(result).toEqual({ success: true, message: 'Publicação iniciada via Orchestrator (Async)' });
  });
});
