import { Injectable, Logger } from '@nestjs/common';
import { OnEvent, EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { XMLParser } from 'fast-xml-parser';
import * as puppeteer from 'puppeteer';
import * as bwipjs from 'bwip-js';
import { FiscalDocumentModel, FiscalDocumentDocument } from '../schemas/fiscal.schema';
import { LegalEntityService } from '../../legal-entity/services/legal-entity.service';
import { FISCAL_EVENTS, FiscalNfeAuthorizedEvent, FiscalDanfeReadyEvent } from '../events/fiscal.events';
import { S3Service } from '../../common/s3/s3.service';
import { DanfeQrCodeService } from './danfe-qrcode.service';

/**
 * Geração de DANFE (PDF) a partir da NFe autorizada. Consumidor independente do evento
 * de emissão — falha aqui NUNCA deve derrubar a emissão fiscal, que já está autorizada
 * e válida perante a SEFAZ mesmo sem o PDF gerado.
 *
 * Layout segue a estrutura padrão do DANFE (Manual de Orientação do Contribuinte —
 * moldura, quadros Emitente/Destinatário/Cálculo do Imposto/Transportador/Produtos,
 * código de barras Code128 da chave de acesso, QR Code de consulta quando CSC
 * configurado). Fonte dos dados é o XML AUTORIZADO (nfe.xml), não o payload do
 * evento — garante que o DANFE reflita exatamente o que foi transmitido à SEFAZ.
 */
@Injectable()
export class FiscalDanfeService {
    private readonly logger = new Logger(FiscalDanfeService.name);
    private readonly xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

    constructor(
        @InjectModel(FiscalDocumentModel.name)
        private readonly fiscalDocumentModel: Model<FiscalDocumentDocument>,
        private readonly legalEntityService: LegalEntityService,
        private readonly s3: S3Service,
        private readonly eventEmitter: EventEmitter2,
        private readonly qrCodeService: DanfeQrCodeService,
    ) { }

    @OnEvent(FISCAL_EVENTS.NFE_AUTHORIZED, { async: true })
    async onAuthorized(event: FiscalNfeAuthorizedEvent): Promise<void> {
        try {
            const parsed = this.parseNFeXml(event.xml);
            // Só existe uma LegalEntity ativa hoje (ver LegalEntityService.findActive) —
            // não busca por CNPJ do XML porque não há método de lookup por CNPJ ainda,
            // e seria prematuro adicioná-lo sem um segundo caso de uso real (YAGNI).
            const legalEntity = await this.legalEntityService.findActive();
            const qrCodeDataUri = await this.qrCodeService.buildQrCodeDataUri({
                accessKey: event.accessKey,
                uf: parsed.emit?.enderEmit?.UF || 'PE',
                environment: parsed.ide?.tpAmb === '1' ? 'PRODUCTION' : 'HOMOLOGATION',
                csc: legalEntity?.csc,
                cscId: legalEntity?.cscId,
            });
            const barcodeDataUri = await this.buildBarcodeDataUri(event.accessKey);

            const pdf = await this.buildDanfePdf(event, parsed, qrCodeDataUri, barcodeDataUri);
            const url = await this.s3.uploadFile(pdf, `fiscal/danfe/${event.accessKey}.pdf`, 'application/pdf', true);
            await this.fiscalDocumentModel.updateOne({ _id: event.nfeId }, { $set: { danfeUrl: url } }).exec();
            this.logger.log(`DANFE gerado para NFe ${event.nfeId}: ${url}`);

            this.eventEmitter.emit(FISCAL_EVENTS.DANFE_READY, new FiscalDanfeReadyEvent(
                event.nfeId, event.orderId, event.accessKey, event.series, event.number,
                event.xml, url, event.customerEmail, event.customerName,
            ));
        } catch (err) {
            this.logger.error(`Falha ao gerar DANFE para NFe ${event.nfeId}: ${err.message}`);
            // Fallback: cliente não deve nunca ficar sem e-mail só porque o PDF falhou —
            // o XML já é o documento fiscal oficial.
            this.eventEmitter.emit(FISCAL_EVENTS.DANFE_FAILED, event);
        }
    }

    /** Extrai infNFe do XML (com ou sem envelope nfeProc) num shape plano para o template. */
    private parseNFeXml(xml: string): any {
        const parsed = this.xmlParser.parse(xml);
        const infNFe = parsed?.nfeProc?.NFe?.infNFe || parsed?.NFe?.infNFe || {};
        const det = Array.isArray(infNFe.det) ? infNFe.det : (infNFe.det ? [infNFe.det] : []);
        return {
            ide: infNFe.ide || {},
            emit: infNFe.emit || {},
            dest: infNFe.dest || {},
            det,
            total: infNFe.total?.ICMSTot || {},
            transp: infNFe.transp || {},
        };
    }

    private async buildBarcodeDataUri(accessKey: string): Promise<string | null> {
        try {
            const png = await bwipjs.toBuffer({
                bcid: 'code128',
                text: accessKey,
                scale: 2,
                height: 12,
                includetext: false,
            });
            return `data:image/png;base64,${png.toString('base64')}`;
        } catch (err) {
            this.logger.warn(`Falha ao gerar código de barras: ${(err as Error).message}`);
            return null;
        }
    }

    private async buildDanfePdf(
        event: FiscalNfeAuthorizedEvent,
        nfe: any,
        qrCodeDataUri: string | null,
        barcodeDataUri: string | null,
    ): Promise<Buffer> {
        const html = this.buildDanfeHtml(event, nfe, qrCodeDataUri, barcodeDataUri);
        const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
        try {
            const page = await browser.newPage();
            await page.setContent(html, { waitUntil: 'networkidle0' });
            const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '8mm', bottom: '8mm', left: '6mm', right: '6mm' } });
            return Buffer.from(pdf);
        } finally {
            await browser.close();
        }
    }

    private buildDanfeHtml(
        event: FiscalNfeAuthorizedEvent,
        nfe: any,
        qrCodeDataUri: string | null,
        barcodeDataUri: string | null,
    ): string {
        const esc = (v: any) => String(v ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' } as any)[c]);
        const money = (v: any) => Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const formattedKey = (event.accessKey.match(/.{1,4}/g) || []).join(' ');

        const emit = nfe.emit || {};
        const dest = nfe.dest || {};
        const total = nfe.total || {};
        const items = nfe.det || [];
        const tpAmb = nfe.ide?.tpAmb;

        const itemsRows = items.map((item: any, idx: number) => {
            const p = item?.prod || {};
            return `<tr>
        <td class="c">${idx + 1}</td>
        <td>${esc(p.cProd)}</td>
        <td>${esc(p.xProd)}</td>
        <td class="c">${esc(p.NCM)}</td>
        <td class="c">${esc(p.CFOP)}</td>
        <td class="c">${esc(p.uCom)}</td>
        <td class="r">${esc(p.qCom)}</td>
        <td class="r">${money(p.vUnCom)}</td>
        <td class="r">${money(p.vProd)}</td>
      </tr>`;
        }).join('');

        return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 9px; color: #000; padding: 0; margin: 0; }
  .frame { border: 1.5px solid #000; padding: 4px; }
  .row { display: flex; }
  .box { border: 1px solid #000; padding: 3px 4px; }
  .box + .box { border-left: none; }
  .label { font-size: 6.5px; color: #444; text-transform: uppercase; display: block; }
  .value { font-size: 9.5px; font-weight: bold; }
  .section-title { font-size: 7px; font-weight: bold; text-transform: uppercase; background: #EEE; padding: 2px 4px; border: 1px solid #000; border-bottom: none; }

  .header { display: flex; border: 1px solid #000; margin-top: 6px; }
  .header .emit { flex: 1.3; padding: 6px; border-right: 1px solid #000; }
  .header .danfe { flex: 0.9; padding: 6px; text-align: center; border-right: 1px solid #000; }
  .header .chave { flex: 1.3; padding: 6px; text-align: center; }
  .emit-name { font-size: 11px; font-weight: bold; }
  .emit-addr { font-size: 8px; margin-top: 2px; }
  .danfe-title { font-size: 14px; font-weight: bold; }
  .danfe-sub { font-size: 7px; margin-top: 2px; }
  .tp-amb { margin-top: 4px; padding: 2px 4px; font-size: 8px; font-weight: bold; }
  .homolog { background: #FEF08A; border: 1px solid #CA8A04; }
  .chave-text { font-family: monospace; font-size: 8.5px; letter-spacing: 0.5px; margin-top: 4px; word-break: break-all; }
  .barcode-img { max-width: 100%; height: 28px; margin-top: 4px; }
  .qr-img { width: 70px; height: 70px; margin-top: 4px; }

  table.items { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 7.5px; }
  table.items th, table.items td { border: 1px solid #000; padding: 2px 3px; }
  table.items th { background: #EEE; font-size: 6.5px; text-transform: uppercase; }
  table.items td.c { text-align: center; }
  table.items td.r { text-align: right; }

  .grid4 { display: flex; margin-top: 6px; }
  .grid4 .box { flex: 1; }

  .footer-note { margin-top: 10px; font-size: 7px; color: #555; text-align: center; }
</style>
</head>
<body>
  <div class="frame">

    ${tpAmb && tpAmb !== '1' ? '<div class="tp-amb homolog">SEM VALOR FISCAL — EMITIDO EM AMBIENTE DE HOMOLOGAÇÃO</div>' : ''}

    <div class="header">
      <div class="emit">
        <div class="emit-name">${esc(emit.xNome)}</div>
        <div class="emit-addr">
          ${esc(emit.enderEmit?.xLgr)}, ${esc(emit.enderEmit?.nro)} — ${esc(emit.enderEmit?.xBairro)}<br/>
          ${esc(emit.enderEmit?.xMun)}/${esc(emit.enderEmit?.UF)} — CEP ${esc(emit.enderEmit?.CEP)}<br/>
          CNPJ: ${esc(emit.CNPJ)} &nbsp; IE: ${esc(emit.IE)}
        </div>
      </div>
      <div class="danfe">
        <div class="danfe-title">DANFE</div>
        <div class="danfe-sub">Documento Auxiliar da<br/>Nota Fiscal Eletrônica</div>
        <div class="danfe-sub" style="margin-top:6px;">
          <span class="label">Nº</span><span class="value">${esc(event.number)}</span> &nbsp;
          <span class="label">Série</span><span class="value">${esc(event.series)}</span>
        </div>
      </div>
      <div class="chave">
        <div class="label">Chave de Acesso</div>
        <div class="chave-text">${esc(formattedKey)}</div>
        ${barcodeDataUri ? `<img class="barcode-img" src="${barcodeDataUri}" />` : ''}
        ${qrCodeDataUri ? `<img class="qr-img" src="${qrCodeDataUri}" />` : ''}
      </div>
    </div>

    <div class="section-title">Destinatário</div>
    <div class="row">
      <div class="box" style="flex:2;">
        <span class="label">Nome / Razão Social</span>
        <span class="value">${esc(dest.xNome)}</span>
      </div>
      <div class="box" style="flex:1;">
        <span class="label">CPF / CNPJ</span>
        <span class="value">${esc(dest.CPF || dest.CNPJ)}</span>
      </div>
    </div>
    <div class="row">
      <div class="box" style="flex:2;">
        <span class="label">Endereço</span>
        <span class="value">${esc(dest.enderDest?.xLgr)}, ${esc(dest.enderDest?.nro)} — ${esc(dest.enderDest?.xBairro)}</span>
      </div>
      <div class="box" style="flex:1;">
        <span class="label">Município / UF</span>
        <span class="value">${esc(dest.enderDest?.xMun)}/${esc(dest.enderDest?.UF)}</span>
      </div>
    </div>

    <div class="section-title">Produtos / Serviços</div>
    <table class="items">
      <thead>
        <tr>
          <th>#</th><th>Código</th><th>Descrição</th><th>NCM</th><th>CFOP</th>
          <th>Un.</th><th>Qtd.</th><th>Vl. Unit.</th><th>Vl. Total</th>
        </tr>
      </thead>
      <tbody>${itemsRows}</tbody>
    </table>

    <div class="section-title">Cálculo do Imposto</div>
    <div class="grid4">
      <div class="box"><span class="label">Base ICMS</span><span class="value">${money(total.vBC)}</span></div>
      <div class="box"><span class="label">Valor ICMS</span><span class="value">${money(total.vICMS)}</span></div>
      <div class="box"><span class="label">Valor Frete</span><span class="value">${money(total.vFrete)}</span></div>
      <div class="box"><span class="label">Valor Desconto</span><span class="value">${money(total.vDesc)}</span></div>
      <div class="box"><span class="label">Valor Total da NF-e</span><span class="value">${money(total.vNF)}</span></div>
    </div>

    <div class="footer-note">
      Consulte pela chave de acesso em www.nfe.fazenda.gov.br, no site da Sefaz Autorizadora ou via QR Code.
    </div>

  </div>
</body>
</html>`;
    }
}
