import { WhatsAppCommandSession } from './whatsapp-command.session';

describe('WhatsAppCommandSession', () => {
  let session: WhatsAppCommandSession;

  beforeEach(() => {
    session = new WhatsAppCommandSession();
  });

  it('consome termo pendente de busca na proxima mensagem', () => {
    session.beginProductSearch('5511999999999');
    const term = session.consumePendingProductSearch('5511999999999', 'Roda Onix');
    expect(term).toBe('Roda Onix');
  });

  it('nao consome mensagem quando nao ha busca pendente', () => {
    const term = session.consumePendingProductSearch('5511999999999', 'Roda Onix');
    expect(term).toBeNull();
  });
});
