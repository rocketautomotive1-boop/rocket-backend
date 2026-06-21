import { formatCancellationMessage } from './cancellation-message.formatter';

describe('formatCancellationMessage', () => {
  const base = {
    externalId: '2000017033161432',
    marketplace: 'Mercado Livre',
    soldAt: '2026-06-20T14:21:00.000-03:00',
    firstItemTitle: 'Jogo Vela Ignição Ford Corcel 1.6 Cht',
    firstQty: 1,
    extraItemsCount: 0,
    totalAmount: 35,
    cancelledBy: 'buyer',
    cancelReason: 'There is a mediation with status cancel_purchase',
    stockReverted: true,
  };

  it('includes marketplace, sale date and item context', () => {
    const msg = formatCancellationMessage(base);
    expect(msg).toContain('MERCADO LIVRE');
    expect(msg).toContain('Jogo Vela Ignição Ford Corcel 1.6 Cht');
    expect(msg).toContain('Quantidade: 1');
    expect(msg).toContain('20/06/2026');
  });

  it('translates raw cancelledBy codes to Portuguese', () => {
    expect(formatCancellationMessage({ ...base, cancelledBy: 'buyer' })).toContain('Cancelado por: Comprador');
    expect(formatCancellationMessage({ ...base, cancelledBy: 'seller' })).toContain('Cancelado por: Vendedor');
    expect(formatCancellationMessage({ ...base, cancelledBy: 'respondent' })).toContain('Cancelado por: Vendedor');
    expect(formatCancellationMessage({ ...base, cancelledBy: null })).toContain('Cancelado por: Sistema');
  });

  it('maps known cancel reasons and shows stock revert line', () => {
    const msg = formatCancellationMessage(base);
    expect(msg).toContain('Mediação de cancelamento');
    expect(msg).toContain('Estoque revertido automaticamente');
  });

  it('omits stock revert line when stock was not reverted', () => {
    const msg = formatCancellationMessage({ ...base, stockReverted: false });
    expect(msg).not.toContain('Estoque revertido');
  });

  it('shows extra items count when the order had more than one item', () => {
    const msg = formatCancellationMessage({ ...base, extraItemsCount: 2 });
    expect(msg).toContain('+ 2 item');
  });
});
