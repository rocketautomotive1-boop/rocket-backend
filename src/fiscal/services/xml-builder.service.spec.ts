import { XmlBuilderService } from './xml-builder.service';

function baseIssuer(): any {
    return {
        cnpj: '67278239000107',
        companyName: 'MAX ESHOP LTDA',
        fantasyName: 'MAX ESHOP LTDA',
        ie: '134858140',
        taxRegime: 'SIMPLES_NACIONAL',
        address: {
            street: 'Rua Carlos Gomes', number: '395', neighborhood: 'MADALENA',
            city: 'RECIFE', state: 'PE', zipCode: '50720135', ibgeCode: '2611606',
        },
    };
}

function baseOrderData(buyer: any): any {
    return {
        buyer,
        items: [
            { id: 'p1', title: 'Produto Teste', quantity: 1, unit_price: 100, seller_custom_field: 'p1' },
        ],
        totals: { amount: 100, freight: 0, discount: 0 },
    };
}

function baseNfe(): any {
    return { orderId: 'order-1', environment: 'PRODUCTION', series: 1, number: 1 };
}

describe('XmlBuilderService — destinatário CPF/CNPJ', () => {
    let service: XmlBuilderService;

    beforeEach(() => {
        service = new XmlBuilderService();
    });

    it('usa <CNPJ> quando o documento do destinatário tem 14 dígitos (pessoa jurídica)', async () => {
        const orderData = baseOrderData({
            document: '03697945000100',
            name: 'DATATECK INDUSTRIA E COMERCIO LTDA.',
            address: { street: 'Costa Gama', number: '110', neighborhood: 'Columbia City', city: 'GUAIBA', state: 'RS', zip_code: '92717330' },
        });

        const xml = await service.buildNFeXml(baseNfe(), orderData, baseIssuer());

        expect(xml).toContain('<CNPJ>03697945000100</CNPJ>');
        expect(xml).not.toContain('<CPF>03697945000100</CPF>');
    });

    it('usa <CPF> quando o documento do destinatário tem 11 dígitos (pessoa física)', async () => {
        const orderData = baseOrderData({
            document: '06726952430',
            name: 'Cliente Pessoa Física',
            address: { street: 'Rua B', number: '2', neighborhood: 'Bairro', city: 'JABOATAO', state: 'PE', zip_code: '54000000' },
        });

        const xml = await service.buildNFeXml(baseNfe(), orderData, baseIssuer());

        expect(xml).toContain('<CPF>06726952430</CPF>');
        expect(xml).not.toContain('<CNPJ>06726952430</CNPJ>');
    });
});

describe('XmlBuilderService — indIEDest / IE do destinatário', () => {
    let service: XmlBuilderService;

    beforeEach(() => {
        service = new XmlBuilderService();
    });

    it('indIEDest=1 + <IE> quando o destinatário PJ tem IE informada (contribuinte)', async () => {
        const orderData = baseOrderData({
            document: '03697945000100',
            ie: '0580097323',
            name: 'DATATECK INDUSTRIA E COMERCIO LTDA.',
            address: { street: 'Costa Gama', number: '110', neighborhood: 'Columbia City', city: 'GUAIBA', state: 'RS', zip_code: '92717330' },
        });

        const xml = await service.buildNFeXml(baseNfe(), orderData, baseIssuer());

        expect(xml).toContain('<IE>0580097323</IE>');
        expect(xml).toContain('<indIEDest>1</indIEDest>');
        // Schema XSD (TDest, xsd:sequence) exige indIEDest ANTES de IE — invertido, a SEFAZ
        // rejeita o lote por violação de schema mesmo com os dois campos presentes/corretos.
        expect(xml.indexOf('<indIEDest>')).toBeLessThan(xml.indexOf('<IE>0580097323</IE>'));
    });

    it('indIEDest=9 sem <IE> quando o destinatário não informa IE (não contribuinte)', async () => {
        const orderData = baseOrderData({
            document: '03697945000100',
            name: 'Empresa Sem IE Informada',
            address: { street: 'Costa Gama', number: '110', neighborhood: 'Columbia City', city: 'GUAIBA', state: 'RS', zip_code: '92717330' },
        });

        const xml = await service.buildNFeXml(baseNfe(), orderData, baseIssuer());

        expect(xml).toContain('<indIEDest>9</indIEDest>');
        expect(xml.indexOf('<dest>') < xml.indexOf('<IE>') && xml.indexOf('<IE>') < xml.indexOf('</dest>')).toBe(false);
    });
});
