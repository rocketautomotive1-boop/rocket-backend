import { of, throwError } from 'rxjs';
import { BrasilApiCnpjAdapter } from './brasil-api-cnpj.adapter';

describe('BrasilApiCnpjAdapter', () => {
  let adapter: BrasilApiCnpjAdapter;
  let httpService: { get: jest.Mock };

  beforeEach(() => {
    httpService = { get: jest.fn() };
    adapter = new BrasilApiCnpjAdapter(httpService as any);
  });

  it('mapeia a resposta real da BrasilAPI corretamente', async () => {
    httpService.get.mockReturnValue(of({
      data: {
        razao_social: 'BANCO DO BRASIL SA',
        nome_fantasia: 'DIRECAO GERAL',
        logradouro: 'SAUN QUADRA 5',
        numero: 'SN',
        bairro: 'ASA NORTE',
        municipio: 'BRASILIA',
        uf: 'DF',
        cep: '70040912',
        descricao_situacao_cadastral: 'ATIVA',
      },
    }));

    const result = await adapter.lookup('00.000.000/0001-91');

    expect(result).toEqual({
      cnpj: '00000000000191',
      companyName: 'BANCO DO BRASIL SA',
      fantasyName: 'DIRECAO GERAL',
      address: {
        street: 'SAUN QUADRA 5',
        number: 'SN',
        neighborhood: 'ASA NORTE',
        city: 'BRASILIA',
        state: 'DF',
        zipCode: '70040912',
      },
      situacao: 'ATIVA',
    });
  });

  it('retorna null quando o CNPJ não existe (404)', async () => {
    httpService.get.mockReturnValue(throwError(() => ({ response: { status: 404 } })));

    const result = await adapter.lookup('11111111111111');
    expect(result).toBeNull();
  });

  it('retorna null (sem exceção) em erro de rede/timeout', async () => {
    httpService.get.mockReturnValue(throwError(() => new Error('ETIMEDOUT')));

    const result = await adapter.lookup('11111111111111');
    expect(result).toBeNull();
  });
});
