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
                // fast-xml-parser converte <tpAmb>1</tpAmb> pro número 1, não a string '1' —
                // === '1' sempre dava false e o QR code apontava pra URL de consulta de
                // HOMOLOGAÇÃO mesmo em produção real.
                environment: String(parsed.ide?.tpAmb ?? '') === '1' ? 'PRODUCTION' : 'HOMOLOGATION',
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

    /** Extrai infNFe + protNFe (protocolo de autorização) do XML autorizado (nfeProc) num
     *  shape plano para o template. protNFe só existe no XML pós-autorização (nfeProc),
     *  nunca no XML de trabalho pré-transmissão — coerente com este service só rodar após
     *  NFE_AUTHORIZED. */
    private parseNFeXml(xml: string): any {
        const parsed = this.xmlParser.parse(xml);
        const infNFe = parsed?.nfeProc?.NFe?.infNFe || parsed?.NFe?.infNFe || {};
        const infProt = parsed?.nfeProc?.protNFe?.infProt || {};
        const det = Array.isArray(infNFe.det) ? infNFe.det : (infNFe.det ? [infNFe.det] : []);
        return {
            ide: infNFe.ide || {},
            emit: infNFe.emit || {},
            dest: infNFe.dest || {},
            det,
            total: infNFe.total?.ICMSTot || {},
            transp: infNFe.transp || {},
            infAdic: infNFe.infAdic || {},
            protocol: { number: infProt.nProt, receivedAt: infProt.dhRecbto },
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
        // Chromium do apt (Dockerfile) via PUPPETEER_EXECUTABLE_PATH — imagem node:22-slim
        // não tem as libs de sistema que o download interno do puppeteer precisaria.
        // --user-data-dir e --disable-dev-shm-usage explícitos: mesmo com $HOME correto
        // (Dockerfile cria o home do usuário 'app'), o crashpad handler do Chromium é
        // sensível a HOME/user-data-dir ausentes em containers — falha silenciosa sem eles.
        const browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--user-data-dir=/tmp/chromium-danfe'],
            ...(process.env.PUPPETEER_EXECUTABLE_PATH ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH } : {}),
        });
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
        const qty = (v: any) => Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
        const cpfCnpj = (doc: string) => {
            const d = String(doc ?? '');
            if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
            if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
            return d;
        };
        const cep = (v: string) => String(v ?? '').replace(/(\d{5})(\d{3})/, '$1-$2');
        const dateBR = (iso: any) => {
            if (!iso) return '';
            const d = new Date(iso);
            return isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR');
        };
        const timeBR = (iso: any) => {
            if (!iso) return '';
            const d = new Date(iso);
            return isNaN(d.getTime()) ? '' : d.toLocaleTimeString('pt-BR');
        };
        const formattedKey = (event.accessKey.match(/.{1,4}/g) || []).join(' ');
        // Nº da NF-e no formato oficial 000.000.NNN (9 dígitos, agrupados de 3 em 3).
        const formattedNumber = String(event.number).padStart(9, '0').replace(/(\d{3})(?=\d)/g, '$1.');

        const emit = nfe.emit || {};
        const dest = nfe.dest || {};
        const total = nfe.total || {};
        const transp = nfe.transp || {};
        const items = nfe.det || [];
        const protocol = nfe.protocol || {};
        // fast-xml-parser converte <tpAmb>1</tpAmb> pro NÚMERO 1 (parsing automático de
        // tipos), não a string '1' — comparar com !== '1' sempre dava true e o DANFE
        // mostrava "SEM VALOR FISCAL — HOMOLOGAÇÃO" mesmo em produção real. String() aqui
        // normaliza antes de comparar.
        const tpAmb = String(nfe.ide?.tpAmb ?? '');
        const isEntrada = String(nfe.ide?.tpNF ?? '1') === '0';
        const destDoc = dest.CNPJ || dest.CPF;
        const vTotTrib = total.vTotTrib;

        const itemsRows = items.map((item: any) => {
            const p = item?.prod || {};
            const icms = item?.imposto?.ICMS || {};
            // ICMS vem num sub-grupo variável por CST/CSOSN (ICMSSN102, ICMS00, ICMS40...) —
            // pega o primeiro (único) filho do grupo, seja qual for o nome.
            const icmsGroup: any = Object.values(icms)[0] || {};
            const origCsosn = [icmsGroup.orig, icmsGroup.CSOSN || icmsGroup.CST].filter((v) => v != null).join('/');
            return `<tr>
        <td>${esc(p.cProd)}</td>
        <td>${esc(p.xProd)}</td>
        <td class="c">${esc(p.NCM)}</td>
        <td class="c">${esc(origCsosn)}</td>
        <td class="c">${esc(p.CFOP)}</td>
        <td class="c">${esc(p.uCom)}</td>
        <td class="r">${qty(p.qCom)}</td>
        <td class="r">${money(p.vUnCom)}</td>
        <td class="r">${money(p.vProd)}</td>
        <td class="r">${money(icmsGroup.vDesc)}</td>
        <td class="r">${money(icmsGroup.vBC)}</td>
        <td class="r">${money(icmsGroup.vICMS)}</td>
        <td class="r">${money(icmsGroup.vIPI)}</td>
        <td class="r">${icmsGroup.pICMS != null ? Number(icmsGroup.pICMS).toFixed(2) : ''}</td>
        <td class="r">${icmsGroup.pIPI != null ? Number(icmsGroup.pIPI).toFixed(2) : ''}</td>
      </tr>`;
        }).join('');

        return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 7.5px; color: #000; padding: 0; margin: 0; }
  .frame { border: 1px solid #000; }
  .row { display: flex; }
  .box { border: 1px solid #000; padding: 2px 4px; border-top: none; border-left: none; }
  .box:first-child { border-left: 1px solid #000; }
  .row:first-child .box { border-top: 1px solid #000; }
  .label { font-size: 5.5px; color: #333; text-transform: uppercase; display: block; }
  .value { font-size: 8.5px; font-weight: bold; }
  .value.sm { font-size: 7.5px; }
  .section-title { font-size: 6px; font-weight: bold; text-transform: uppercase; background: #fff; padding: 1px 4px; border: 1px solid #000; border-top: none; border-left: none; border-bottom: none; margin-top: -1px; }
  .tp-amb { padding: 2px 4px; font-size: 8px; font-weight: bold; text-align: center; }
  .homolog { background: #FEF08A; border: 1px solid #CA8A04; }

  /* Canhoto */
  .canhoto { border: 1px dashed #000; margin: 4px; padding: 3px; display: flex; font-size: 6.5px; }
  .canhoto .info { flex: 3; padding-right: 6px; }
  .canhoto .recebedor { flex: 4; border-left: 1px dashed #000; padding-left: 6px; }
  .canhoto .nfe-box { flex: 1.2; border-left: 1px dashed #000; padding-left: 6px; text-align: center; }
  .canhoto .nfe-box .big { font-size: 10px; font-weight: bold; }

  /* Header */
  .header { display: flex; border: 1px solid #000; margin: 0 4px; }
  .header .emit { flex: 1.5; padding: 4px; border-right: 1px solid #000; }
  .header .danfe { flex: 1; padding: 4px; text-align: center; border-right: 1px solid #000; display: flex; flex-direction: column; justify-content: center; }
  .header .chave { flex: 1.6; padding: 4px; text-align: center; }
  .emit-name { font-size: 10.5px; font-weight: bold; }
  .emit-addr { font-size: 7px; margin-top: 2px; line-height: 1.4; }
  .danfe-title { font-size: 13px; font-weight: bold; }
  .danfe-sub { font-size: 6px; margin-top: 1px; }
  .tipo-box { display: inline-block; border: 1px solid #000; width: 14px; height: 14px; line-height: 14px; font-weight: bold; margin-top: 3px; }
  .danfe-num { font-size: 7px; margin-top: 4px; }
  .danfe-num b { font-size: 9px; }
  .chave-label { font-size: 6px; font-weight: bold; }
  .chave-text { font-family: 'Courier New', monospace; font-size: 8px; letter-spacing: 0.5px; margin-top: 2px; }
  .barcode-img { max-width: 100%; height: 22px; margin-top: 3px; }
  .qr-img { width: 55px; height: 55px; margin-top: 3px; }
  .consulta-note { font-size: 5.5px; margin-top: 2px; line-height: 1.3; }

  .m4 { margin: 0 4px; }
  .mt4 { margin-top: 4px; }

  table.items { width: 100%; border-collapse: collapse; font-size: 6px; }
  table.items th, table.items td { border: 1px solid #000; padding: 1.5px 2px; }
  table.items th { background: #fff; font-size: 5px; text-transform: uppercase; font-weight: bold; }
  table.items td.c { text-align: center; }
  table.items td.r { text-align: right; }

  .grid { display: flex; }
  .grid .box { flex: 1; }

  .transp-grid1 { display: flex; }
  .transp-grid1 .box:nth-child(1) { flex: 2.5; }
  .transp-grid1 .box:nth-child(2) { flex: 1; }
  .transp-grid1 .box:nth-child(3) { flex: 1; }
  .transp-grid1 .box:nth-child(4) { flex: 0.6; }
  .transp-grid1 .box:nth-child(5) { flex: 1.4; }
  .transp-grid2 { display: flex; }
  .transp-grid2 .box:nth-child(1) { flex: 2; }
  .transp-grid2 .box:nth-child(2) { flex: 1; }
  .transp-grid2 .box:nth-child(3) { flex: 0.6; }
  .transp-grid2 .box:nth-child(4) { flex: 1; }
  .transp-grid3 { display: flex; }
  .transp-grid3 .box { flex: 1; }

  .adic { display: flex; margin: 0 4px 4px; border: 1px solid #000; border-top: none; }
  .adic .info-compl { flex: 2; padding: 3px; border-right: 1px solid #000; }
  .adic .fisco { flex: 1; padding: 3px; }
  .adic-label { font-size: 5.5px; font-weight: bold; text-transform: uppercase; display: block; margin-bottom: 2px; }
  .adic-text { font-size: 7px; line-height: 1.4; }

  .print-footer { font-size: 6px; color: #555; padding: 2px 4px; }
</style>
</head>
<body>
  <div class="frame">

    <div class="canhoto">
      <div class="info">
        RECEBEMOS DE ${esc(emit.xNome)} OS PRODUTOS E/OU SERVIÇOS CONSTANTES DA NOTA FISCAL ELETRÔNICA INDICADA ABAIXO.<br/><br/>
        EMISSÃO: ${dateBR(nfe.ide?.dhEmi)} &nbsp; VALOR TOTAL: R$ ${money(total.vNF)} &nbsp;
        DESTINATÁRIO: ${esc(dest.xNome)} - ${esc(dest.enderDest?.xLgr)}, ${esc(dest.enderDest?.nro)} ${esc(dest.enderDest?.xBairro)} ${esc(dest.enderDest?.xMun)}-${esc(dest.enderDest?.UF)}
      </div>
      <div class="recebedor">
        <span class="label">Data de Recebimento</span><br/><br/>
        <span class="label">Identificação e Assinatura do Recebedor</span>
      </div>
      <div class="nfe-box">
        <div class="big">NF-e</div>
        <div>Nº ${formattedNumber}</div>
        <div>Série ${String(event.series).padStart(3, '0')}</div>
      </div>
    </div>

    ${tpAmb && tpAmb !== '1' ? '<div class="tp-amb homolog m4">SEM VALOR FISCAL — EMITIDO EM AMBIENTE DE HOMOLOGAÇÃO</div>' : ''}

    <div class="header mt4">
      <div class="emit">
        <div class="emit-name">${esc(emit.xNome)}</div>
        <div class="emit-addr">
          ${esc(emit.enderEmit?.xLgr)}, ${esc(emit.enderEmit?.nro)}<br/>
          ${esc(emit.enderEmit?.xBairro)} — CEP ${cep(emit.enderEmit?.CEP)}<br/>
          ${esc(emit.enderEmit?.xMun)} - ${esc(emit.enderEmit?.UF)}
        </div>
      </div>
      <div class="danfe">
        <div class="danfe-title">DANFE</div>
        <div class="danfe-sub">Documento Auxiliar da<br/>Nota Fiscal Eletrônica</div>
        <div class="tipo-box">${isEntrada ? '0' : '1'}</div>
        <div class="danfe-num">Nº <b>${String(event.number).padStart(9, '0')}</b><br/>Série <b>${String(event.series).padStart(3, '0')}</b></div>
      </div>
      <div class="chave">
        <div class="chave-label">Chave de Acesso</div>
        <div class="chave-text">${esc(formattedKey)}</div>
        ${barcodeDataUri ? `<img class="barcode-img" src="${barcodeDataUri}" />` : ''}
        ${qrCodeDataUri ? `<img class="qr-img" src="${qrCodeDataUri}" />` : ''}
        <div class="consulta-note">Consulta de autenticidade no portal nacional da NF-e<br/>www.nfe.fazenda.gov.br/portal ou no site da Sefaz Autorizadora</div>
      </div>
    </div>

    <div class="row m4 mt4">
      <div class="box" style="flex:2.5;">
        <span class="label">Natureza da Operação</span>
        <span class="value">${esc(nfe.ide?.natOp)}</span>
      </div>
      <div class="box" style="flex:1.5;">
        <span class="label">Protocolo de Autorização de Uso</span>
        <span class="value sm">${esc(protocol.number)}${protocol.receivedAt ? ` - ${dateBR(protocol.receivedAt)} ${timeBR(protocol.receivedAt)}` : ''}</span>
      </div>
    </div>
    <div class="row m4">
      <div class="box" style="flex:1;">
        <span class="label">Inscrição Estadual</span>
        <span class="value">${esc(emit.IE)}</span>
      </div>
      <div class="box" style="flex:1;">
        <span class="label">Inscrição Municipal</span>
        <span class="value">${esc(emit.IM)}</span>
      </div>
      <div class="box" style="flex:1;">
        <span class="label">Inscrição Estadual do Subst. Tribut.</span>
        <span class="value">${esc(emit.IEST)}</span>
      </div>
      <div class="box" style="flex:1;">
        <span class="label">CNPJ / CPF</span>
        <span class="value sm">${esc(cpfCnpj(emit.CNPJ || emit.CPF))}</span>
      </div>
    </div>

    <div class="section-title m4">Destinatário / Remetente</div>
    <div class="row m4">
      <div class="box" style="flex:2.5;">
        <span class="label">Nome / Razão Social</span>
        <span class="value">${esc(dest.xNome)}</span>
      </div>
      <div class="box" style="flex:1;">
        <span class="label">CNPJ / CPF</span>
        <span class="value sm">${esc(cpfCnpj(destDoc))}</span>
      </div>
      <div class="box" style="flex:1;">
        <span class="label">Data da Emissão</span>
        <span class="value sm">${dateBR(nfe.ide?.dhEmi)}</span>
      </div>
    </div>
    <div class="row m4">
      <div class="box" style="flex:1.8;">
        <span class="label">Endereço</span>
        <span class="value sm">${esc(dest.enderDest?.xLgr)}, ${esc(dest.enderDest?.nro)}</span>
      </div>
      <div class="box" style="flex:1;">
        <span class="label">Bairro / Distrito</span>
        <span class="value sm">${esc(dest.enderDest?.xBairro)}</span>
      </div>
      <div class="box" style="flex:0.8;">
        <span class="label">CEP</span>
        <span class="value sm">${cep(dest.enderDest?.CEP)}</span>
      </div>
      <div class="box" style="flex:1;">
        <span class="label">Data da Saída/Entrada</span>
        <span class="value sm">${dateBR(nfe.ide?.dhSaiEnt || nfe.ide?.dhEmi)}</span>
      </div>
    </div>
    <div class="row m4">
      <div class="box" style="flex:1.3;">
        <span class="label">Município</span>
        <span class="value sm">${esc(dest.enderDest?.xMun)}</span>
      </div>
      <div class="box" style="flex:0.4;">
        <span class="label">UF</span>
        <span class="value sm">${esc(dest.enderDest?.UF)}</span>
      </div>
      <div class="box" style="flex:1;">
        <span class="label">Fone / Fax</span>
        <span class="value sm">&nbsp;</span>
      </div>
      <div class="box" style="flex:1;">
        <span class="label">Inscrição Estadual</span>
        <span class="value sm">${esc(dest.IE)}</span>
      </div>
      <div class="box" style="flex:1;">
        <span class="label">Hora da Saída/Entrada</span>
        <span class="value sm">${timeBR(nfe.ide?.dhSaiEnt || nfe.ide?.dhEmi)}</span>
      </div>
    </div>

    <div class="section-title m4">Cálculo do Imposto</div>
    <div class="grid m4">
      <div class="box"><span class="label">Base Cálc. do ICMS</span><span class="value sm">${money(total.vBC)}</span></div>
      <div class="box"><span class="label">Valor do ICMS</span><span class="value sm">${money(total.vICMS)}</span></div>
      <div class="box"><span class="label">Base Cálc. ICMS S.T.</span><span class="value sm">${money(total.vBCST)}</span></div>
      <div class="box"><span class="label">Valor do ICMS Subst.</span><span class="value sm">${money(total.vST)}</span></div>
      <div class="box"><span class="label">V. Imp. Importação</span><span class="value sm">${money(total.vII)}</span></div>
      <div class="box"><span class="label">V. ICMS UF Remet.</span><span class="value sm">${money(total.vICMSUFRemet)}</span></div>
      <div class="box"><span class="label">V. FCP UF Dest.</span><span class="value sm">${money(total.vFCPUFDest)}</span></div>
      <div class="box"><span class="label">V. Total Produtos</span><span class="value sm">${money(total.vProd)}</span></div>
    </div>
    <div class="grid m4">
      <div class="box"><span class="label">Valor do Frete</span><span class="value sm">${money(total.vFrete)}</span></div>
      <div class="box"><span class="label">Valor do Seguro</span><span class="value sm">${money(total.vSeg)}</span></div>
      <div class="box"><span class="label">Desconto</span><span class="value sm">${money(total.vDesc)}</span></div>
      <div class="box"><span class="label">Outras Despesas</span><span class="value sm">${money(total.vOutro)}</span></div>
      <div class="box"><span class="label">Valor Total IPI</span><span class="value sm">${money(total.vIPI)}</span></div>
      <div class="box"><span class="label">V. ICMS UF Dest.</span><span class="value sm">${money(total.vICMSUFDest)}</span></div>
      <div class="box"><span class="label">V. Tot. Trib.</span><span class="value sm">${vTotTrib != null ? money(vTotTrib) : ''}</span></div>
      <div class="box"><span class="label">Valor Total da Nota</span><span class="value">${money(total.vNF)}</span></div>
    </div>

    <div class="section-title m4">Transportador / Volumes Transportados</div>
    <div class="transp-grid1 m4">
      <div class="box"><span class="label">Nome / Razão Social</span><span class="value sm">&nbsp;</span></div>
      <div class="box"><span class="label">Frete</span><span class="value sm">${esc(this.freteLabel(transp.modFrete))}</span></div>
      <div class="box"><span class="label">Código ANTT</span><span class="value sm">&nbsp;</span></div>
      <div class="box"><span class="label">UF</span><span class="value sm">&nbsp;</span></div>
      <div class="box"><span class="label">CNPJ / CPF</span><span class="value sm">&nbsp;</span></div>
    </div>
    <div class="transp-grid2 m4">
      <div class="box"><span class="label">Endereço</span><span class="value sm">&nbsp;</span></div>
      <div class="box"><span class="label">Município</span><span class="value sm">&nbsp;</span></div>
      <div class="box"><span class="label">UF</span><span class="value sm">&nbsp;</span></div>
      <div class="box"><span class="label">Inscrição Estadual</span><span class="value sm">&nbsp;</span></div>
    </div>
    <div class="transp-grid3 m4">
      <div class="box"><span class="label">Quantidade</span><span class="value sm">&nbsp;</span></div>
      <div class="box"><span class="label">Espécie</span><span class="value sm">&nbsp;</span></div>
      <div class="box"><span class="label">Marca</span><span class="value sm">&nbsp;</span></div>
      <div class="box"><span class="label">Numeração</span><span class="value sm">&nbsp;</span></div>
      <div class="box"><span class="label">Peso Bruto</span><span class="value sm">&nbsp;</span></div>
      <div class="box"><span class="label">Peso Líquido</span><span class="value sm">&nbsp;</span></div>
    </div>

    <div class="section-title m4">Dados dos Produtos / Serviços</div>
    <table class="items m4" style="width: calc(100% - 8px); margin: 0 4px;">
      <thead>
        <tr>
          <th>Código Produto</th><th>Descrição do Produto / Serviço</th><th>NCM/SH</th><th>O/CSOSN</th><th>CFOP</th>
          <th>Un</th><th>Quant</th><th>Valor Unit</th><th>Valor Total</th><th>Valor Desc</th>
          <th>B.Cálc ICMS</th><th>Valor ICMS</th><th>Valor IPI</th><th>Alíq. ICMS</th><th>Alíq. IPI</th>
        </tr>
      </thead>
      <tbody>${itemsRows}</tbody>
    </table>

    <div class="section-title m4 mt4">Dados Adicionais</div>
    <div class="adic">
      <div class="info-compl">
        <span class="adic-label">Informações Complementares</span>
        <span class="adic-text">${esc(nfe.infAdic?.infCpl)}</span>
      </div>
      <div class="fisco">
        <span class="adic-label">Reservado ao Fisco</span>
        <span class="adic-text">${esc(nfe.infAdic?.infAdFisco)}</span>
      </div>
    </div>

    <div class="print-footer">
      Impresso em ${dateBR(new Date())} as ${timeBR(new Date())}
    </div>

  </div>
</body>
</html>`;
    }

    /** Rótulo do indicador de frete (modFrete) — Manual de Orientação do Contribuinte. */
    private freteLabel(modFrete: any): string {
        const labels: Record<string, string> = {
            '0': '0-Emitente',
            '1': '1-Destinatário',
            '2': '2-Terceiros',
            '3': '3-Próprio por conta do Remetente',
            '4': '4-Próprio por conta do Destinatário',
            '9': '9-Sem Transporte',
        };
        return labels[String(modFrete ?? '9')] || '9-Sem Transporte';
    }
}
