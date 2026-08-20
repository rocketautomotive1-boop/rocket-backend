import { ServiceUnavailableException } from '@nestjs/common';
import { CpfLookupAdapter } from './cpf-lookup.adapter';

describe('CpfLookupAdapter', () => {
  it('lança ServiceUnavailableException quando CPF_LOOKUP_PROVIDER não está configurado', async () => {
    const configService = { get: jest.fn().mockReturnValue(undefined) };
    const adapter = new CpfLookupAdapter(configService as any);

    await expect(adapter.lookup('06726952430')).rejects.toThrow(ServiceUnavailableException);
    await expect(adapter.lookup('06726952430')).rejects.toThrow(/Consulta de CPF não configurada/);
  });

  it('lança ServiceUnavailableException (adapter não implementado) mesmo com provider configurado', async () => {
    const configService = { get: jest.fn().mockReturnValue('infosimples') };
    const adapter = new CpfLookupAdapter(configService as any);

    await expect(adapter.lookup('06726952430')).rejects.toThrow(/sem adapter implementado/);
  });
});
