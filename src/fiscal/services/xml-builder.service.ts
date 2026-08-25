
import { Injectable, Logger } from '@nestjs/common';
import { XMLBuilder } from 'fast-xml-parser';
import { v4 as uuidv4 } from 'uuid';
import { FiscalDocumentModel } from '../schemas/fiscal.schema';
import { LegalEntityModel } from '../../legal-entity/schemas/legal-entity.schema';

@Injectable()
export class XmlBuilderService {
  private readonly logger = new Logger(XmlBuilderService.name);
  private readonly builder: XMLBuilder;

  constructor() {
    this.builder = new XMLBuilder({
      ignoreAttributes: false,
      format: false,
      suppressBooleanAttributes: false,
    });
  }

  async buildNFeXml(nfe: FiscalDocumentModel, orderData: any, issuer: LegalEntityModel, marketplaceSellerId?: string, tpEmis: string = '1'): Promise<string> {
    this.logger.log(`Building NFe XML for order ${nfe.orderId}`);

    // Basic Validation
    if (!orderData.buyer || !orderData.items) {
      throw new Error('Dados do pedido inválidos para emissão de NFe');
    }

    const isProduction = nfe.environment === 'PRODUCTION';
    const tpAmb = isProduction ? '1' : '2';

    // Determine if operation is internal (same state) or interstate
    const issuerUF = this.getStateCode(issuer.address.state);
    const buyerUF  = this.getStateCode(orderData.buyer.address?.state || '');
    const isInterstate = !!(buyerUF && buyerUF !== issuerUF);
    const idDest = isInterstate ? '2' : '1';
    const taxRegimeNorm = String(issuer.taxRegime || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const isSimples = ['SIMPLESNACIONAL', 'SIMPLES', 'SN', '1'].includes(taxRegimeNorm);

    this.logger.log(
      `[buildNFeXml] taxRegime="${issuer.taxRegime}" → isSimples=${isSimples}, CRT=${isSimples ? '1' : '3'}`
    );
    this.logger.log(
      `CFOP/idDest: issuer=${issuerUF} buyer=${buyerUF} interstate=${isInterstate} ` +
      `→ CFOP=${isInterstate ? '6108' : '5102'} idDest=${idDest}`
    );

    // Marketplace intermediary (infIntermed)
    const mpIntermed = this.getMarketplaceIntermed(orderData.marketplaceName, marketplaceSellerId);

    // Generate accurate cNF (Random 8 digits for now, but part of key)
    const cNF = Math.floor(Math.random() * 99999999).toString().padStart(8, '0');

    const nfeData: any = {
      NFe: {
        '@_xmlns': 'http://www.portalfiscal.inf.br/nfe',
        infNFe: {
          '@_versao': '4.00',
          ide: {
            cUF: this.getStateIbgeCode(this.getStateCode(issuer.address.state)),
            cNF: cNF,
            natOp: 'Venda de mercadoria para consumidor final',
            mod: '55',
            serie: String(nfe.series),
            nNF: String(nfe.number),
            // Adjusted for Timezone (UTC-3) and Safety Buffer (10 min)
            dhEmi: new Date(Date.now() - (3 * 60 + 10) * 60 * 1000).toISOString().split('.')[0] + '-03:00',
            dhSaiEnt: new Date(Date.now() - (3 * 60 + 10) * 60 * 1000).toISOString().split('.')[0] + '-03:00',
            tpNF: '1', // 1=Saída
            idDest,
            cMunFG: issuer.address.ibgeCode,
            tpImp: '1', // Portrait
            tpEmis: tpEmis, // 1=Normal, 4=EPEC (Contingência)
            cDV: '0', // Will update after key calc
            tpAmb: tpAmb,
            finNFe: '1', // Normal
            indFinal: '1', // Consumidor final
            indPres: '2', // Internet
            indIntermed: mpIntermed ? '1' : '0', // 1=Marketplace/intermediador
            procEmi: '0', // App proprietário
            verProc: 'Rocket 1.0',
          },
          emit: {
            CNPJ: issuer.cnpj.replace(/\D/g, ''),
            xNome: (issuer.companyName || '').substring(0, 60),
            xFant: (issuer.fantasyName || '').substring(0, 60),
            enderEmit: {
              xLgr: issuer.address.street,
              nro: issuer.address.number,
              xBairro: issuer.address.neighborhood,
              cMun: issuer.address.ibgeCode,
              xMun: issuer.address.city,
              UF: this.getStateCode(issuer.address.state),
              CEP: issuer.address.zipCode.replace(/\D/g, ''),
              cPais: '1058',
              xPais: 'BRASIL',
              ...(issuer.address.phone ? { fone: issuer.address.phone.replace(/\D/g, '') } : {})
            },
            IE: issuer.ie.replace(/\D/g, ''),
            CRT: isSimples ? '1' : '3',
          },
          dest: {
            ...(() => {
              const digits = (orderData.buyer.cnpj || orderData.buyer.cpf || orderData.buyer.document || '00000000000').replace(/\D/g, '');
              // CNPJ tem 14 dígitos, CPF tem 11 — o schema XSD da NFe exige o elemento
              // certo pro tamanho do documento (SEFAZ rejeita com "Falha no esquema XML"
              // se um CNPJ de 14 dígitos for enviado como <CPF>).
              return digits.length === 14 ? { CNPJ: digits } : { CPF: digits };
            })(),
            // SEFAZ exige esse texto literal no xNome do destinatário quando tpAmb=2 (homologação);
            // sem ele, o lote é rejeitado com cStat 598 mesmo com todos os outros dados corretos.
            xNome: isProduction
              ? (orderData.buyer.name || (orderData.buyer.first_name || '') + ' ' + (orderData.buyer.last_name || '')).substring(0, 60)
              : 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL',
            // Fix 275: Use Capital Code if city_ibge is missing but State is known
            enderDest: {
              xLgr: orderData.buyer.address?.street || 'Rua Desconhecida',
              nro: orderData.buyer.address?.number || 'S/N',
              xBairro: orderData.buyer.address?.neighborhood || 'Centro',
              cMun: orderData.buyer.address?.city_ibge || this.getCapitalIbgeCode(this.getStateCode(orderData.buyer.address?.state || 'SP')),
              xMun: orderData.buyer.address?.city || 'Cidade',
              UF: this.getStateCode(orderData.buyer.address?.state || 'SP'),
              CEP: (orderData.buyer.address?.zipCode || '00000000').replace(/\D/g, ''),
              cPais: '1058',
              xPais: 'BRASIL',
              ...(orderData.buyer.phone ? { fone: orderData.buyer.phone.replace(/\D/g, '') } : {})
            },
            // indIEDest: 1=Contribuinte ICMS (exige <IE>), 2=Contribuinte isento, 9=Não
            // Contribuinte. Destinatário PJ com IE informada é contribuinte — declarar como
            // "9" nesse caso causa rejeição SEFAZ 232 "IE do destinatário não informada"
            // (a SEFAZ cruza o CNPJ com o cadastro estadual e espera a IE quando ela existe).
            // ORDEM IMPORTA: o schema XSD da NFe (TDest, xsd:sequence) exige indIEDest
            // ANTES de IE — invertido, o schema é violado mesmo com os dois campos corretos.
            ...(orderData.buyer.ie
              ? { indIEDest: '1', IE: orderData.buyer.ie.replace(/\D/g, '') }
              : { indIEDest: '9' }),
          },
          det: orderData.items.map((item: any, index: number) => {
            const vProd = Number(item.quantity) * Number(item.unit_price);
            // IBPT approximation (~27% for auto parts NCM 87089990 — informativo, Lei 12.741/2012)
            const ibptRate = item.ibptRate ?? 0.2719;
            const vTotTribItem = parseFloat((vProd * ibptRate).toFixed(2));
            const cfop = item.cfop || (isInterstate ? '6108' : '5102');
            return {
              '@_nItem': index + 1,
              prod: {
                cProd: String(item.internalProduct?.id || item.seller_custom_field || item.sku || item.id),
                cEAN: 'SEM GTIN',
                xProd: (item.title || 'Produto sem título').substring(0, 120),
                NCM: item.ncm || '87089990',
                ...(item.cest ? { CEST: item.cest } : {}),
                CFOP: cfop,
                uCom: item.uCom || 'UN',
                qCom: Number(item.quantity).toFixed(4),
                vUnCom: Number(item.unit_price).toFixed(8),
                vProd: vProd.toFixed(2),
                cEANTrib: 'SEM GTIN',
                uTrib: item.uCom || 'UN',
                qTrib: Number(item.quantity).toFixed(4),
                vUnTrib: Number(item.unit_price).toFixed(8),
                indTot: '1',
                ...(item.xPed ? { xPed: String(item.xPed) } : {}),
              },
              imposto: {
                vTotTrib: vTotTribItem.toFixed(2),
                ICMS: isSimples
                  ? { ICMSSN102: { orig: item.origin || '0', CSOSN: issuer.csosn || '102' } }
                  : { ICMS40:    { orig: item.origin || '0', CST: issuer.cst || '41'   } },
                // CST 99 (Outras) não tributado — padrão do Faturador do ML mesmo para
                // itens sem incidência real de IPI; declarar o grupo, mesmo zerado, evita
                // divergência de leiaute frente a fiscalizações que cruzam NFe de autopeças.
                IPI: {
                  cEnq: item.cEnq || '999',
                  IPITrib: { CST: '99', vBC: vProd.toFixed(2), pIPI: '0.0000', vIPI: '0.00' },
                },
                PIS:    { PISNT:    { CST: '07' } },
                COFINS: { COFINSNT: { CST: '07' } },
              },
            };
          }),
          total: (() => {
            const vNF = Number(orderData.totals?.amount || orderData.total_amount || 0);
            const ibptRate = 0.2719;
            const vTotTrib = parseFloat((vNF * ibptRate).toFixed(2));
            return {
              ICMSTot: {
                vBC: '0.00',
                vICMS: '0.00',
                vICMSDeson: '0.00',
                vFCP: '0.00',
                vBCST: '0.00',
                vST: '0.00',
                vFCPST: '0.00',
                vFCPSTRet: '0.00',
                vProd: vNF.toFixed(2),
                vFrete: Number(orderData.totals?.freight || 0).toFixed(2),
                vSeg: '0.00',
                vDesc: Number(orderData.totals?.discount || 0).toFixed(2),
                vII: '0.00',
                vIPI: '0.00',
                vIPIDevol: '0.00',
                vPIS: '0.00',
                vCOFINS: '0.00',
                vOutro: '0.00',
                vNF: vNF.toFixed(2),
                vTotTrib: vTotTrib.toFixed(2),
              }
            };
          })(),
          transp: this.buildTransp(mpIntermed, orderData.items),
          pag: {
            detPag: this.buildDetPag(orderData),
          },
          ...(mpIntermed ? {
            infIntermed: {
              CNPJ: mpIntermed.cnpj,
              idCadIntTran: mpIntermed.idCadIntTran,
            }
          } : {}),
          infAdic: (() => {
            const infAdFisco = isSimples ? 'Emitido por ME/EPP optante do Simples Nacional.' : undefined;
            const vTotTribDisplay = parseFloat((Number(orderData.totals?.amount || 0) * 0.2719).toFixed(2));
            const infCpl = `Valor aproximado dos tributos (IBPT) R$${vTotTribDisplay.toFixed(2)}.` +
              (orderData.additionalInfo ? ' ' + orderData.additionalInfo : '');
            return { infAdFisco, infCpl };
          })(),
          infRespTec: {
            CNPJ: issuer.cnpj.replace(/\D/g, ''),
            xContato: ((issuer as any).responsibleContact || issuer.fantasyName || issuer.companyName || '').substring(0, 60),
            email: (issuer as any).email || 'suporte@rocket.com.br',
            fone: ((issuer as any).phone || issuer.address?.phone || '').replace(/\D/g, '') || '11999999999',
          },
        }
      }
    };

    // Access Key Calculation
    let generatedKey = nfe.accessKey;

    // Always regenerate Access Key to ensure synchronization with current tag values (cNF, dhEmi, cUF)
    // especially when reusing NFe number where 'cNF' is random generated on every build.
    generatedKey = this.generateAccessKey(
      nfeData.NFe.infNFe.ide.cUF,
      nfeData.NFe.infNFe.ide.dhEmi,
      nfeData.NFe.infNFe.emit.CNPJ,
      nfeData.NFe.infNFe.ide.mod,
      nfeData.NFe.infNFe.ide.serie,
      nfeData.NFe.infNFe.ide.nNF,
      nfeData.NFe.infNFe.ide.tpEmis,
      nfeData.NFe.infNFe.ide.cNF
    );
    // Update NFe entity so we save this key later
    nfe.accessKey = generatedKey;

    nfeData.NFe.infNFe['@_Id'] = `NFe${generatedKey}`;
    nfeData.NFe.infNFe.ide.cDV = generatedKey.slice(-1);

    return this.builder.build(nfeData);
  }

  private generateAccessKey(cUF: string, dhEmi: string, cnpj: string, mod: string, serie: string, nNF: string, tpEmis: string, cNF: string): string {
    const year = dhEmi.substring(2, 4); // YY
    const month = dhEmi.substring(5, 7); // MM

    const keyBase = `${cUF}${year}${month}${cnpj}${mod}${serie.padStart(3, '0')}${nNF.padStart(9, '0')}${tpEmis}${cNF}`;
    const cDV = this.calculateCheckDigit(keyBase);

    return `${keyBase}${cDV}`;
  }

  private calculateCheckDigit(keyBase: string): string {
    let weight = 2;
    let sum = 0;

    for (let i = keyBase.length - 1; i >= 0; i--) {
      sum += parseInt(keyBase[i]) * weight;
      weight++;
      if (weight > 9) weight = 2;
    }

    const remainder = sum % 11;
    const digit = remainder < 2 ? 0 : 11 - remainder;
    return digit.toString();
  }

  private getStateCode(stateName: string): string {
    if (!stateName) return 'SP'; // Default
    if (stateName.length === 2) return stateName.toUpperCase();

    const normalized = stateName.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    const states: { [key: string]: string } = {
      'acre': 'AC', 'alagoas': 'AL', 'amapa': 'AP', 'amazonas': 'AM', 'bahia': 'BA', 'ceara': 'CE',
      'distrito federal': 'DF', 'espirito santo': 'ES', 'goias': 'GO', 'maranhao': 'MA', 'mato grosso': 'MT',
      'mato grosso do sul': 'MS', 'minas gerais': 'MG', 'para': 'PA', 'paraiba': 'PB', 'parana': 'PR',
      'pernambuco': 'PE', 'piaui': 'PI', 'rio de janeiro': 'RJ', 'rio grande do norte': 'RN',
      'rio grande do sul': 'RS', 'rondonia': 'RO', 'roraima': 'RR', 'santa catarina': 'SC',
      'sao paulo': 'SP', 'sergipe': 'SE', 'tocantins': 'TO'
    };

    return states[normalized] || 'SP';
  }

  private getStateIbgeCode(uf: string): string {
    const codes: { [key: string]: string } = {
      'AC': '12', 'AL': '27', 'AP': '16', 'AM': '13', 'BA': '29', 'CE': '23',
      'DF': '53', 'ES': '32', 'GO': '52', 'MA': '21', 'MT': '51', 'MS': '50',
      'MG': '31', 'PA': '15', 'PB': '25', 'PR': '41', 'PE': '26', 'PI': '22',
      'RJ': '33', 'RN': '24', 'RS': '43', 'RO': '11', 'RR': '14', 'SC': '42',
      'SP': '35', 'SE': '28', 'TO': '17'
    };
    return codes[uf] || '35'; // Default SP
  }

  private getCapitalIbgeCode(uf: string): string {
    // Map State to Capital City IBGE Code
    const capitals: { [key: string]: string } = {
      'AC': '1200401', 'AL': '2704302', 'AP': '1600303', 'AM': '1302603', 'BA': '2927408',
      'CE': '2304400', 'DF': '5300108', 'ES': '3205309', 'GO': '5208707', 'MA': '2111300',
      'MT': '5103403', 'MS': '5002704', 'MG': '3106200', 'PA': '1501402', 'PB': '2507507',
      'PR': '4106902', 'PE': '2611606', 'PI': '2211001', 'RJ': '3304557', 'RN': '2408102',
      'RS': '4314902', 'RO': '1100205', 'RR': '1400100', 'SC': '4205407', 'SP': '3550308',
      'SE': '2800308', 'TO': '1721000'
    };
    return capitals[uf] || '3550308'; // Default SP - Sao Paulo
  }

  /** Um <detPag> por pagamento — o Faturador do ML sempre gera indPag=0 (à vista) e o
   *  grupo <card> com cAut sempre que há código de autorização, mesmo em PIX (a
   *  integradora do marketplace emite um "cAut" próprio tipo "PIXE..."). Se
   *  orderData.payments não estiver presente (dados antigos/edição manual no modal),
   *  cai para orderData.payment singular — um só <detPag>, mesmo comportamento de antes. */
  private buildDetPag(orderData: any): any {
    const payments: any[] = Array.isArray(orderData.payments) && orderData.payments.length
      ? orderData.payments
      : [orderData.payment].filter(Boolean);

    if (payments.length === 0) {
      return { indPag: '0', tPag: '99', xPag: this.getPaymentDescription(undefined), vPag: Number(orderData.totals?.amount || orderData.total_amount || 0).toFixed(2) };
    }

    return payments.map((payment) => {
      const tPag = this.getPaymentType(payment?.paymentType);
      const vPag = Number(payment?.amount ?? orderData.totals?.amount ?? orderData.total_amount ?? 0).toFixed(2);
      const authorizationCode = (payment?.authorizationCode || '').substring(0, 20);
      return {
        indPag: '0',
        tPag,
        ...(tPag === '99' ? { xPag: this.getPaymentDescription(payment?.paymentType) } : {}),
        vPag,
        ...(authorizationCode ? {
          card: {
            tpIntegra: '1', // Integrado
            CNPJ: '03007331000141', // CNPJ da Credenciadora (Mercado Pago/ML)
            tBand: this.getTBand(payment?.paymentMethodId),
            cAut: authorizationCode,
          }
        } : {}),
      };
    });
  }

  private getPaymentType(type: string): string {
    const map: { [key: string]: string } = {
      'credit_card': '03',
      'debit_card': '04',
      'ticket': '15',
      'bank_transfer': '17', // PIX usually
      'account_money': '99',
    };
    // Fallback: If type is missing, assume 99 (Outros) or check logic
    return map[type] || '99';
  }

  private getPaymentDescription(type: string): string {
    const map: { [key: string]: string } = {
      'account_money': 'Dinheiro em conta',
      'digital_wallet': 'Carteira Digital',
      'pix': 'PIX',
      'boleto': 'Boleto Bancario',
    };
    return map[type] || 'Outros';
  }

  /** Dados do intermediador (marketplace) para infIntermed.
   *  idCadIntTran = ID do vendedor cadastrado no marketplace (resolvido por
   *  Store.fiscalChannels[].marketplaceSellerId, passado explicitamente pelo chamador).
   *  cnpj = CNPJ conhecido do próprio marketplace intermediador.
   */
  private getMarketplaceIntermed(
    name?: string,
    marketplaceSellerId?: string,
  ): { cnpj: string; idCadIntTran: string; xNome: string } | null {
    if (!name) return null;
    const id = marketplaceSellerId?.trim();
    if (!id || id.length < 2) return null; // omit infIntermed if seller ID not configured
    const n = name.toLowerCase();
    if (n.includes('mercado') || n.includes('meli'))    return { cnpj: '03007331000141', idCadIntTran: id, xNome: 'Ebazar.com.br LTDA.' };
    if (n.includes('amazon'))                            return { cnpj: '15436940000103', idCadIntTran: id, xNome: 'Amazon Servicos de Varejo do Brasil LTDA.' };
    if (n.includes('shopee'))                             return { cnpj: '43468032000113', idCadIntTran: id, xNome: 'Shopee Brasil Servicos e Tecnologia LTDA.' };
    if (n.includes('magalu') || n.includes('magazine'))   return { cnpj: '47960950001921', idCadIntTran: id, xNome: 'Magazine Luiza S.A.' };
    if (n.includes('americanas') || n.includes('b2w'))    return { cnpj: '00776574000156', idCadIntTran: id, xNome: 'B2W Companhia Digital' };
    return null;
  }

  /** modFrete=2 (destinatário/emitente contrata, mas transporte é feito pelo próprio
   *  marketplace via Mercado Envios/Fulfillment) + grupo transporta/vol quando há
   *  intermediador resolvido e ao menos um item com peso informado. Sem isso, modFrete=9
   *  (sem transporte), igual ao comportamento anterior. */
  private buildTransp(
    mpIntermed: { cnpj: string; idCadIntTran: string; xNome: string } | null,
    items: any[],
  ): any {
    if (!mpIntermed) return { modFrete: '9' };

    const totalWeight = (items || []).reduce((sum, item) => sum + (Number(item.weight) || 0) * (Number(item.quantity) || 1), 0);
    if (totalWeight <= 0) return { modFrete: '9' };

    return {
      modFrete: '2',
      transporta: {
        CNPJ: mpIntermed.cnpj,
        xNome: mpIntermed.xNome,
      },
      vol: {
        pesoL: totalWeight.toFixed(3),
        pesoB: totalWeight.toFixed(3),
      },
    };
  }

  private getTBand(methodId: string): string {
    if (!methodId) return '99';

    const normalized = methodId.toLowerCase();

    // Flags Map
    // 01=Visa, 02=Mastercard, 03=Amex, 04=Sorocred, 05=Diners, 06=Elo, 07=Hipercard
    const map: { [key: string]: string } = {
      'visa': '01',
      'master': '02',
      'mastercard': '02',
      'amex': '03',
      'american_express': '03',
      'sorocred': '04',
      'diners': '05',
      'elo': '06',
      'hipercard': '07',
      'aura': '08',
      'cabal': '09',
      'alelo': '10',
      'banescard': '11',
      'calcard': '12',
      'credz': '13',
      'discover': '14',
      'goodcard': '15',
      'greencard': '16',
      'hiper': '17',
      'jcb': '18',
      'mais': '19',
      'maxvan': '20',
      'policard': '21',
      'redecompras': '22',
      'sodexo': '23',
      'valecard': '24',
      'verocheque': '25',
      'vr': '26',
      'ticket': '27'
    };

    return map[normalized] || '99';
  }
}

