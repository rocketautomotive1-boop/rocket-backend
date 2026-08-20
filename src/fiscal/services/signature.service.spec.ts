import * as forge from 'node-forge';
import { SignatureService } from './signature.service';

/** Gera um PKCS#12 self-signed sintético com CN no formato ICP-Brasil (RAZÃO SOCIAL:CNPJ). */
function buildTestPfx(cn: string, password: string): string {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);

  const attrs = [{ name: 'commonName', value: cn }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey);

  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, { algorithm: '3des' });
  const p12Der = forge.asn1.toDer(p12Asn1).getBytes();
  return forge.util.encode64(p12Der);
}

describe('SignatureService.extractCertificateData', () => {
  const service = new SignatureService();

  it('extrai CNPJ e razão social do CN no formato ICP-Brasil (RAZAO SOCIAL:CNPJ)', () => {
    const pfx = buildTestPfx('ROCKET AUTO PECAS LTDA:00000000000191', 'senha123');

    const result = service.extractCertificateData(pfx, 'senha123');

    expect(result.cnpj).toBe('00000000000191');
    expect(result.companyName).toBe('ROCKET AUTO PECAS LTDA');
    expect(result.validUntil).toBeInstanceOf(Date);
    expect(result.validUntil.getTime()).toBeGreaterThan(Date.now());
  });

  it('lida com razão social contendo ":" — usa o último segmento como CNPJ', () => {
    const pfx = buildTestPfx('AUTO PECAS: MATRIZ LTDA:12345678000190', 'senha123');

    const result = service.extractCertificateData(pfx, 'senha123');

    expect(result.cnpj).toBe('12345678000190');
    expect(result.companyName).toBe('AUTO PECAS: MATRIZ LTDA');
  });
});
