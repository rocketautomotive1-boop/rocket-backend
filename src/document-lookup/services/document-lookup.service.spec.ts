import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { DocumentLookupService } from './document-lookup.service';
import { CNPJ_LOOKUP_PORT } from '../ports/cnpj-lookup.port';
import { CPF_LOOKUP_PORT } from '../ports/cpf-lookup.port';
import { DocumentLookupAuditModel } from '../schemas/document-lookup-audit.schema';

describe('DocumentLookupService', () => {
  let service: DocumentLookupService;
  let cnpjPort: { lookup: jest.Mock };
  let cpfPort: { lookup: jest.Mock };
  let auditModel: { create: jest.Mock };

  beforeEach(async () => {
    cnpjPort = { lookup: jest.fn().mockResolvedValue({ cnpj: '00000000000191', companyName: 'X' }) };
    cpfPort = { lookup: jest.fn().mockResolvedValue({ cpf: '06726952430', name: 'Y' }) };
    auditModel = { create: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        DocumentLookupService,
        { provide: CNPJ_LOOKUP_PORT, useValue: cnpjPort },
        { provide: CPF_LOOKUP_PORT, useValue: cpfPort },
        { provide: getModelToken(DocumentLookupAuditModel.name), useValue: auditModel },
      ],
    }).compile();

    service = moduleRef.get(DocumentLookupService);
  });

  it('lookupCnpj: consulta a fonte na primeira chamada, usa cache na segunda', async () => {
    await service.lookupCnpj('00000000000191');
    await service.lookupCnpj('00000000000191');

    expect(cnpjPort.lookup).toHaveBeenCalledTimes(1);
  });

  it('lookupCpf: audita toda consulta, mesmo com cache hit', async () => {
    await service.lookupCpf('06726952430', undefined, 'user-1');
    await service.lookupCpf('06726952430', undefined, 'user-1');

    expect(cpfPort.lookup).toHaveBeenCalledTimes(1);
    expect(auditModel.create).toHaveBeenCalledTimes(2);
    expect(auditModel.create).toHaveBeenCalledWith({
      document: '06726952430', purpose: 'emissao_fiscal', lookedUpBy: 'user-1',
    });
  });
});
