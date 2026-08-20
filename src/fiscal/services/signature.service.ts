import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import * as forge from 'node-forge';
import { SignedXml } from 'xml-crypto';

@Injectable()
export class SignatureService {
    private readonly logger = new Logger(SignatureService.name);

    public getCertAndKey(pfxBase64: string, password?: string): { cert: string, key: string } {
        const pfxDer = forge.util.decode64(pfxBase64);
        const pfxAsn1 = forge.asn1.fromDer(pfxDer);
        const pfx = forge.pkcs12.pkcs12FromAsn1(pfxAsn1, false, password);

        // Get Key and Cert
        const bags = pfx.getBags({ bagType: forge.pki.oids.certBag });
        const certBag = bags[forge.pki.oids.certBag]?.[0];

        let keyBag: forge.pkcs12.Bag | undefined;
        // Check for PKCS#8 Shrouded Key Bag
        const pkcs8Bags = pfx.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
        keyBag = pkcs8Bags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0];

        // If not found, check for plain Key Bag
        if (!keyBag) {
            const keyBags = pfx.getBags({ bagType: forge.pki.oids.keyBag });
            keyBag = keyBags[forge.pki.oids.keyBag]?.[0];
        }

        if (!certBag || !keyBag) {
            throw new Error('Certificado ou Chave Privada não encontrados no arquivo PFX.');
        }

        const cert = forge.pki.certificateToPem(certBag.cert!);
        if (!keyBag.key) {
            throw new Error('Falha interna: Chave privada detectada mas não pôde ser lida.');
        }

        const key = forge.pki.privateKeyToPem(keyBag.key!);

        return { cert, key };
    }

    /**
     * Extrai CNPJ/razão social/validade do certificado e-CNPJ ICP-Brasil.
     * O Subject.CN de um e-CNPJ segue o formato "RAZÃO SOCIAL:CNPJ" — padrão
     * ICP-Brasil, não específico deste projeto. Não extrai IE/endereço/regime
     * tributário (o certificado não carrega esses dados) — ver CccLookupService
     * e SefazCadConsultaCadastroAdapter para completar via consulta SEFAZ.
     */
    public extractCertificateData(pfxBase64: string, password?: string): { cnpj: string; companyName: string; validUntil: Date } {
        const { cert } = this.getCertAndKey(pfxBase64, password);
        const forgeCert = forge.pki.certificateFromPem(cert);
        const cn = forgeCert.subject.getField('CN')?.value || '';
        const lastColon = cn.lastIndexOf(':');
        const companyName = (lastColon >= 0 ? cn.substring(0, lastColon) : cn).trim();
        const cnpjRaw = lastColon >= 0 ? cn.substring(lastColon + 1) : '';
        return {
            cnpj: cnpjRaw.replace(/\D/g, ''),
            companyName,
            validUntil: forgeCert.validity.notAfter,
        };
    }

    /** Sign a cancellation/event XML — Signature inserted inside <evento> after <infEvento> */
    async signEventXml(xml: string, pfxBase64: string, password?: string): Promise<string> {
        this.logger.log('Signing event XML (infEvento)...');
        try {
            const { cert, key } = this.getCertAndKey(pfxBase64, password);
            const cleanCert = cert
                .replace('-----BEGIN CERTIFICATE-----', '')
                .replace('-----END CERTIFICATE-----', '')
                .replace(/[\r\n]/g, '');

            const sig = new SignedXml();
            (sig as any).privateKey = key;
            (sig as any).keyInfoProvider = {
                getKeyInfo: () => `<X509Data><X509Certificate>${cleanCert}</X509Certificate></X509Data>`,
                getKey: () => key,
            };

            sig.addReference({
                xpath: "//*[local-name(.)='infEvento']",
                transforms: [
                    'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
                    'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
                ],
                digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
            });

            sig.canonicalizationAlgorithm = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
            sig.signatureAlgorithm = 'http://www.w3.org/2000/09/xmldsig#rsa-sha1';

            // SEFAZ schema requires <Signature> inside <evento> as sibling of <infEvento>,
            // NOT at the <envEvento> root. Use location.after to place it right after infEvento.
            sig.computeSignature(xml, {
                location: {
                    reference: "//*[local-name(.)='infEvento']",
                    action: 'after',
                },
            });

            let signedXml = sig.getSignedXml();
            if (!signedXml.includes('<KeyInfo>')) {
                const keyInfoXml = `<KeyInfo><X509Data><X509Certificate>${cleanCert}</X509Certificate></X509Data></KeyInfo>`;
                signedXml = signedXml.replace('</Signature>', `${keyInfoXml}</Signature>`);
            }

            this.logger.log(`Event XML signed. Signed length: ${signedXml.length}`);
            return signedXml;
        } catch (error) {
            this.logger.error('Failed to sign event XML:', error);
            throw new InternalServerErrorException(`Erro na assinatura do evento: ${error.message}`);
        }
    }

    async signXml(xml: string, pfxBase64: string, password?: string): Promise<string> {
        this.logger.log('Signing XML...');

        try {
            const { cert, key } = this.getCertAndKey(pfxBase64, password);

            this.logger.log(`Chave privada extraída. Tamanho PEM: ${key.length} caracteres.`);

            // Xml Crypto Signature
            const sig = new SignedXml();

            // Explicitly set privateKey (xml-crypto v6 uses privateKey, not signingKey)
            (sig as any).privateKey = key;

            // Configure KeyInfo Provider to include X509Certificate
            const cleanCert = cert
                .replace('-----BEGIN CERTIFICATE-----', '')
                .replace('-----END CERTIFICATE-----', '')
                .replace(/[\r\n]/g, '');

            (sig as any).keyInfoProvider = {
                getKeyInfo: () => {
                    return `<X509Data><X509Certificate>${cleanCert}</X509Certificate></X509Data>`;
                },
                getKey: () => key // Optional, but good practice
            };

            this.logger.debug('PrivateKey set. Type: ' + typeof (sig as any).privateKey);

            // Transforms for NFe
            sig.addReference({
                xpath: "//*[local-name(.)='infNFe']",
                transforms: [
                    'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
                    'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'
                ],
                digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1'
            });

            sig.canonicalizationAlgorithm = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
            sig.signatureAlgorithm = 'http://www.w3.org/2000/09/xmldsig#rsa-sha1';

            this.logger.debug('Computing signature...');
            try {
                sig.computeSignature(xml);
            } catch (innerErr) {
                this.logger.error(`Error inside computeSignature: ${innerErr.message}`);
                throw innerErr;
            }

            // Append Signature
            let signedXml = sig.getSignedXml();

            // Manual check: Ensure KeyInfo is present. If xml-crypto skipped it, we force it.
            if (!signedXml.includes('<KeyInfo>')) {
                this.logger.warn('KeyInfo missing from generated signature. Injecting manually...');
                const keyInfoXml = `<KeyInfo><X509Data><X509Certificate>${cleanCert}</X509Certificate></X509Data></KeyInfo>`;
                signedXml = signedXml.replace('</Signature>', `${keyInfoXml}</Signature>`);
            }

            return signedXml;
        } catch (error) {
            this.logger.error('Failed to sign XML:', error);
            throw new InternalServerErrorException(`Erro na assinatura digital: ${error.message}`);
        }
    }
}
