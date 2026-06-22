import { formatReturnMessage } from './return-message.formatter';

describe('formatReturnMessage', () => {
  it('monta a mensagem com tipo, item, comprador, valor e ids', () => {
    const msg = formatReturnMessage({
      claimId: '136',
      marketplace: 'Mercado Livre',
      claimType: 'returns',
      stage: 'claim',
      orderId: '2000',
      buyerName: 'João',
      firstItemTitle: 'Rádio Multimídia',
      firstQty: 1,
      extraItemsCount: 2,
      totalAmount: 800,
      soldAt: '2026-06-22T16:00:00.000Z',
    });
    expect(msg).toContain('DEVOLUÇÃO / RECLAMAÇÃO');
    expect(msg).toContain('Tipo: Devolução');
    expect(msg).toContain('Situação: Reclamação aberta');
    expect(msg).toContain('*Rádio Multimídia*');
    expect(msg).toContain('(+ 2 item(ns))');
    expect(msg).toContain('Comprador: João');
    expect(msg).toContain('R$ 800,00');
    expect(msg).toContain('Pedido: 2000');
    expect(msg).toContain('Reclamação: 136');
  });

  it('omite linhas opcionais ausentes (sem pedido/valor/item)', () => {
    const msg = formatReturnMessage({ claimId: '9', marketplace: 'ML', claimType: 'mediations' });
    expect(msg).toContain('Tipo: Mediação');
    expect(msg).not.toContain('Pedido:');
    expect(msg).not.toContain('Valor:');
    expect(msg).not.toContain('Comprador:');
    expect(msg).toContain('Reclamação: 9');
  });

  it('cai para rótulo genérico quando o tipo é desconhecido', () => {
    const msg = formatReturnMessage({ claimId: '1', marketplace: 'ML', claimType: 'xyz' });
    expect(msg).toContain('Tipo: Devolução / Reclamação');
  });
});
