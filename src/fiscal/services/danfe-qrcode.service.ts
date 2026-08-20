import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import * as QRCode from 'qrcode';

/**
 * URLs de consulta do QR Code por UF (Nota Técnica 2015/002). Hoje só PE está
 * coberto porque é a única UF que o SefazService transmite (nfe.sefaz.pe.gov.br) —
 * expandir aqui junto com SefazService quando outras UFs forem suportadas.
 */
const QR_CONSULTA_URL_BY_UF: Record<string, { production: string; homologation: string }> = {
    PE: {
        production: 'https://nfe.sefaz.pe.gov.br/nfe-consulta-publica/nfe-consulta.jsf',
        homologation: 'https://nfehomolog.sefaz.pe.gov.br/nfe-consulta-publica/nfe-consulta.jsf',
    },
};

@Injectable()
export class DanfeQrCodeService {
    private readonly logger = new Logger(DanfeQrCodeService.name);

    /**
     * Monta a URL do QR Code de consulta (NT 2015/002 v1.60) e renderiza como PNG
     * base64 (data URI), pronto para embutir em <img> no template DANFE.
     * Retorna null se faltar UF suportada ou CSC — nunca gera um QR Code com hash
     * incorreto (falharia silenciosamente na consulta real da SEFAZ).
     */
    async buildQrCodeDataUri(params: {
        accessKey: string;
        uf: string;
        environment: string; // 'PRODUCTION' | 'HOMOLOGATION'
        csc?: string;
        cscId?: string;
    }): Promise<string | null> {
        const { accessKey, uf, environment, csc, cscId } = params;

        if (!csc || !cscId) {
            this.logger.debug('CSC/cscId ausente na LegalEntity — QR Code omitido do DANFE.');
            return null;
        }
        const urls = QR_CONSULTA_URL_BY_UF[uf.toUpperCase()];
        if (!urls) {
            this.logger.debug(`UF ${uf} sem URL de consulta QR Code mapeada — QR Code omitido do DANFE.`);
            return null;
        }
        const baseUrl = environment === 'PRODUCTION' ? urls.production : urls.homologation;
        const tpAmb = environment === 'PRODUCTION' ? '1' : '2';
        const nVersao = '100';

        const payload = `chNFe=${accessKey}&nVersao=${nVersao}&tpAmb=${tpAmb}&cIdToken=${cscId}`;
        const hash = crypto.createHash('sha1').update(payload + csc).digest('hex');
        const query = `chNFe=${accessKey}&nVersao=${nVersao}&tpAmb=${tpAmb}&cIdToken=${cscId}&cHashQRCode=${hash}`;
        const qrUrl = `${baseUrl}?${query}`;

        try {
            return await QRCode.toDataURL(qrUrl, { errorCorrectionLevel: 'M', margin: 1, width: 180 });
        } catch (err) {
            this.logger.warn(`Falha ao renderizar QR Code: ${(err as Error).message}`);
            return null;
        }
    }
}
