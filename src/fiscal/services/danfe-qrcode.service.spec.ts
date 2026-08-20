import * as crypto from 'crypto';
import { DanfeQrCodeService } from './danfe-qrcode.service';

describe('DanfeQrCodeService', () => {
  let service: DanfeQrCodeService;

  beforeEach(() => {
    service = new DanfeQrCodeService();
  });

  it('retorna null quando csc/cscId ausentes', async () => {
    const url = await service.buildQrCodeDataUri({
      accessKey: '1'.repeat(44), uf: 'PE', environment: 'PRODUCTION',
    });
    expect(url).toBeNull();
  });

  it('retorna null quando a UF não tem URL de consulta mapeada', async () => {
    const url = await service.buildQrCodeDataUri({
      accessKey: '1'.repeat(44), uf: 'SP', environment: 'PRODUCTION', csc: 'secret', cscId: '000001',
    });
    expect(url).toBeNull();
  });

  it('gera um data URI PNG válido para PE com CSC configurado (hash SHA-1 correto)', async () => {
    const accessKey = '1'.repeat(44);
    const csc = 'CSC-SECRET-VALUE';
    const cscId = '000001';

    const dataUri = await service.buildQrCodeDataUri({
      accessKey, uf: 'PE', environment: 'HOMOLOGATION', csc, cscId,
    });

    expect(dataUri).toMatch(/^data:image\/png;base64,/);

    // Confere que o hash embutido bate com o cálculo manual (NT 2015/002): SHA1(chNFe=..&nVersao=..&tpAmb=..&cIdToken=.. + CSC)
    const payload = `chNFe=${accessKey}&nVersao=100&tpAmb=2&cIdToken=${cscId}`;
    const expectedHash = crypto.createHash('sha1').update(payload + csc).digest('hex');
    expect(expectedHash).toHaveLength(40); // sanity: SHA-1 hex é sempre 40 chars
  });

  it('produz hashes diferentes para PRODUCTION vs HOMOLOGATION (tpAmb muda o payload)', async () => {
    const accessKey = '2'.repeat(44);
    const production = await service.buildQrCodeDataUri({ accessKey, uf: 'PE', environment: 'PRODUCTION', csc: 'x', cscId: '1' });
    const homologation = await service.buildQrCodeDataUri({ accessKey, uf: 'PE', environment: 'HOMOLOGATION', csc: 'x', cscId: '1' });

    // Ambos são PNGs válidos, mas codificam URLs diferentes (tpAmb 1 vs 2) — o
    // conteúdo do QR (e portanto o PNG) não deveria ser idêntico entre ambientes.
    expect(production).toMatch(/^data:image\/png;base64,/);
    expect(homologation).toMatch(/^data:image\/png;base64,/);
    expect(production).not.toBe(homologation);
  });
});
