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
            address: { street: 'Costa Gama', number: '110', neighborhood: 'Columbia City', city: 'GUAIBA', state: 'RS', zipCode: '92717330' },
        });

        const xml = await service.buildNFeXml(baseNfe(), orderData, baseIssuer());

        expect(xml).toContain('<CNPJ>03697945000100</CNPJ>');
        expect(xml).not.toContain('<CPF>03697945000100</CPF>');
    });

    it('usa <CPF> quando o documento do destinatário tem 11 dígitos (pessoa física)', async () => {
        const orderData = baseOrderData({
            document: '06726952430',
            name: 'Cliente Pessoa Física',
            address: { street: 'Rua B', number: '2', neighborhood: 'Bairro', city: 'JABOATAO', state: 'PE', zipCode: '54000000' },
        });

        const xml = await service.buildNFeXml(baseNfe(), orderData, baseIssuer());

        expect(xml).toContain('<CPF>06726952430</CPF>');
        expect(xml).not.toContain('<CNPJ>06726952430</CNPJ>');
    });
});

describe('XmlBuilderService — endereço do destinatário (sem fallback silencioso)', () => {
    let service: XmlBuilderService;

    beforeEach(() => {
        service = new XmlBuilderService();
    });

    it('grava o CEP real do destinatário no XML — antes um zipCode ausente virava "00000000" sem erro, o que a SEFAZ aceita mas o Mercado Livre rejeita depois (wrong_receiver_zipcode)', async () => {
        const orderData = baseOrderData({
            document: '06726952430',
            name: 'Cliente Teste',
            address: { street: 'Rua B', number: '2', neighborhood: 'Bairro', city: 'JABOATAO', state: 'PE', zipCode: '54000000' },
        });

        const xml = await service.buildNFeXml(baseNfe(), orderData, baseIssuer());

        expect(xml).toContain('<CEP>54000000</CEP>');
        expect(xml).not.toContain('<CEP>00000000</CEP>');
    });

    it.each([
        ['street', { number: '2', neighborhood: 'Bairro', city: 'JABOATAO', state: 'PE', zipCode: '54000000' }],
        ['neighborhood', { street: 'Rua B', number: '2', city: 'JABOATAO', state: 'PE', zipCode: '54000000' }],
        ['city', { street: 'Rua B', number: '2', neighborhood: 'Bairro', state: 'PE', zipCode: '54000000' }],
        ['state', { street: 'Rua B', number: '2', neighborhood: 'Bairro', city: 'JABOATAO', zipCode: '54000000' }],
        ['zipCode', { street: 'Rua B', number: '2', neighborhood: 'Bairro', city: 'JABOATAO', state: 'PE' }],
    ])('rejeita com erro claro quando address.%s está ausente, em vez de mascarar com fallback', async (field, address) => {
        const orderData = baseOrderData({ document: '06726952430', name: 'Cliente Teste', address });

        await expect(service.buildNFeXml(baseNfe(), orderData, baseIssuer())).rejects.toThrow(
            new RegExp(`Endereço do destinatário incompleto.*${field}`),
        );
    });

    it('rejeita quando o destinatário não tem documento (CPF/CNPJ) algum — antes gerava CPF fake "00000000000"', async () => {
        const orderData = baseOrderData({
            name: 'Cliente Sem Documento',
            address: { street: 'Rua B', number: '2', neighborhood: 'Bairro', city: 'JABOATAO', state: 'PE', zipCode: '54000000' },
        });

        await expect(service.buildNFeXml(baseNfe(), orderData, baseIssuer())).rejects.toThrow(/Documento.*destinatário ausente/);
    });

    it('number ausente usa "S/N" (valor de domínio legítimo — endereço sem numeração —, não fallback de dado faltante)', async () => {
        const orderData = baseOrderData({
            document: '06726952430',
            name: 'Cliente Teste',
            address: { street: 'Rua B', neighborhood: 'Bairro', city: 'JABOATAO', state: 'PE', zipCode: '54000000' },
        });

        const xml = await service.buildNFeXml(baseNfe(), orderData, baseIssuer());

        expect(xml).toContain('<nro>S/N</nro>');
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
            address: { street: 'Costa Gama', number: '110', neighborhood: 'Columbia City', city: 'GUAIBA', state: 'RS', zipCode: '92717330' },
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
            address: { street: 'Costa Gama', number: '110', neighborhood: 'Columbia City', city: 'GUAIBA', state: 'RS', zipCode: '92717330' },
        });

        const xml = await service.buildNFeXml(baseNfe(), orderData, baseIssuer());

        expect(xml).toContain('<indIEDest>9</indIEDest>');
        expect(xml.indexOf('<dest>') < xml.indexOf('<IE>') && xml.indexOf('<IE>') < xml.indexOf('</dest>')).toBe(false);
    });
});

describe('XmlBuilderService — CSOSN/CST do item (configurável por LegalEntity)', () => {
    let service: XmlBuilderService;

    beforeEach(() => {
        service = new XmlBuilderService();
    });

    it('usa o CSOSN configurado em issuer.csosn para emitente do Simples Nacional', async () => {
        const issuer = { ...baseIssuer(), taxRegime: 'SIMPLES_NACIONAL', csosn: '500' };
        const orderData = baseOrderData({
            document: '03697945000100',
            name: 'DATATECK INDUSTRIA E COMERCIO LTDA.',
            address: { street: 'Costa Gama', number: '110', neighborhood: 'Columbia City', city: 'GUAIBA', state: 'RS', zipCode: '92717330' },
        });

        const xml = await service.buildNFeXml(baseNfe(), orderData, issuer);

        expect(xml).toContain('<CSOSN>500</CSOSN>');
        expect(xml).not.toContain('<CSOSN>102</CSOSN>');
    });

    it('usa CSOSN 102 como default quando issuer.csosn não está configurado (Simples Nacional)', async () => {
        const issuer = { ...baseIssuer(), taxRegime: 'SIMPLES_NACIONAL' };
        const orderData = baseOrderData({
            document: '03697945000100',
            name: 'DATATECK INDUSTRIA E COMERCIO LTDA.',
            address: { street: 'Costa Gama', number: '110', neighborhood: 'Columbia City', city: 'GUAIBA', state: 'RS', zipCode: '92717330' },
        });

        const xml = await service.buildNFeXml(baseNfe(), orderData, issuer);

        expect(xml).toContain('<CSOSN>102</CSOSN>');
    });

    it('usa o CST configurado em issuer.cst para emitente fora do Simples Nacional', async () => {
        const issuer = { ...baseIssuer(), taxRegime: 'NORMAL', cst: '00' };
        const orderData = baseOrderData({
            document: '03697945000100',
            name: 'DATATECK INDUSTRIA E COMERCIO LTDA.',
            address: { street: 'Costa Gama', number: '110', neighborhood: 'Columbia City', city: 'GUAIBA', state: 'RS', zipCode: '92717330' },
        });

        const xml = await service.buildNFeXml(baseNfe(), orderData, issuer);

        expect(xml).toContain('<CST>00</CST>');
        expect(xml).not.toContain('<CST>41</CST>');
    });

    it('usa CST 41 como default quando issuer.cst não está configurado (fora do Simples)', async () => {
        const issuer = { ...baseIssuer(), taxRegime: 'NORMAL' };
        const orderData = baseOrderData({
            document: '03697945000100',
            name: 'DATATECK INDUSTRIA E COMERCIO LTDA.',
            address: { street: 'Costa Gama', number: '110', neighborhood: 'Columbia City', city: 'GUAIBA', state: 'RS', zipCode: '92717330' },
        });

        const xml = await service.buildNFeXml(baseNfe(), orderData, issuer);

        expect(xml).toContain('<CST>41</CST>');
    });
});

describe('XmlBuilderService — transp (transportadora Mercado Envios)', () => {
    let service: XmlBuilderService;

    beforeEach(() => {
        service = new XmlBuilderService();
    });

    it('declara transporta + vol quando orderData.marketplaceName é Mercado Livre e há peso do item', async () => {
        const orderData = {
            ...baseOrderData({
                document: '03697945000100',
                name: 'DATATECK INDUSTRIA E COMERCIO LTDA.',
                address: { street: 'Costa Gama', number: '110', neighborhood: 'Columbia City', city: 'GUAIBA', state: 'RS', zipCode: '92717330' },
            }),
            marketplaceName: 'Mercado Livre',
        };
        orderData.items[0].weight = 1.48;

        const xml = await service.buildNFeXml(baseNfe(), orderData, baseIssuer(), '3475525806');

        expect(xml).toContain('<modFrete>2</modFrete>');
        expect(xml).toContain('<transporta><CNPJ>03007331000141</CNPJ><xNome>Ebazar.com.br LTDA.</xNome>');
        expect(xml).toContain('<vol><pesoL>1.480</pesoL><pesoB>1.480</pesoB></vol>');
    });

    it('mantém modFrete=9 sem transporta quando não há marketplace resolvido', async () => {
        const orderData = baseOrderData({
            document: '03697945000100',
            name: 'DATATECK INDUSTRIA E COMERCIO LTDA.',
            address: { street: 'Costa Gama', number: '110', neighborhood: 'Columbia City', city: 'GUAIBA', state: 'RS', zipCode: '92717330' },
        });

        const xml = await service.buildNFeXml(baseNfe(), orderData, baseIssuer());

        expect(xml).toContain('<modFrete>9</modFrete>');
        expect(xml).not.toContain('<transporta>');
    });
});

describe('XmlBuilderService — pag (indPag, card por meio de pagamento, múltiplos pagamentos)', () => {
    let service: XmlBuilderService;

    beforeEach(() => {
        service = new XmlBuilderService();
    });

    it('inclui indPag=0 e card com cAut para pagamento via PIX (orderData.payments)', async () => {
        const orderData = {
            ...baseOrderData({
                document: '03697945000100',
                name: 'DATATECK INDUSTRIA E COMERCIO LTDA.',
                address: { street: 'Costa Gama', number: '110', neighborhood: 'Columbia City', city: 'GUAIBA', state: 'RS', zipCode: '92717330' },
            }),
            payments: [
                { paymentType: 'bank_transfer', authorizationCode: 'PIXE0000000020260805', amount: 100 },
            ],
        };

        const xml = await service.buildNFeXml(baseNfe(), orderData, baseIssuer());

        // cAut truncado em 20 chars — limite do XSD da NFe 4.00 (o Faturador do ML excede
        // esse limite nos exemplos reais, mas isso é uma inconsistência do ML, não do schema).
        expect(xml).toContain('<detPag><indPag>0</indPag><tPag>17</tPag><vPag>100.00</vPag><card><tpIntegra>1</tpIntegra><CNPJ>03007331000141</CNPJ><tBand>99</tBand><cAut>PIXE0000000020260805</cAut></card></detPag>');
    });

    it('gera um <detPag> por pagamento quando o pedido tem múltiplos pagamentos', async () => {
        const orderData = {
            ...baseOrderData({
                document: '03697945000100',
                name: 'DATATECK INDUSTRIA E COMERCIO LTDA.',
                address: { street: 'Costa Gama', number: '110', neighborhood: 'Columbia City', city: 'GUAIBA', state: 'RS', zipCode: '92717330' },
            }),
            payments: [
                { paymentType: 'credit_card', paymentMethodId: 'master', authorizationCode: '681582', amount: 234.5 },
                { paymentType: 'credit_card', paymentMethodId: 'master', authorizationCode: '681520', amount: 265.5 },
            ],
        };

        const xml = await service.buildNFeXml(baseNfe(), orderData, baseIssuer());

        expect(xml).toContain('<cAut>681582</cAut>');
        expect(xml).toContain('<cAut>681520</cAut>');
        expect((xml.match(/<detPag>/g) || []).length).toBe(2);
    });

    it('mantém compatibilidade com orderData.payment singular quando payments[] não está presente', async () => {
        const orderData = baseOrderData({
            document: '03697945000100',
            name: 'DATATECK INDUSTRIA E COMERCIO LTDA.',
            address: { street: 'Costa Gama', number: '110', neighborhood: 'Columbia City', city: 'GUAIBA', state: 'RS', zipCode: '92717330' },
        });
        orderData.payment = { paymentType: 'credit_card', paymentMethodId: 'visa', authorizationCode: '818261' };

        const xml = await service.buildNFeXml(baseNfe(), orderData, baseIssuer());

        expect(xml).toContain('<indPag>0</indPag>');
        expect(xml).toContain('<cAut>818261</cAut>');
        expect((xml.match(/<detPag>/g) || []).length).toBe(1);
    });
});

describe('XmlBuilderService — IPI do item', () => {
    let service: XmlBuilderService;

    beforeEach(() => {
        service = new XmlBuilderService();
    });

    it('declara IPITrib CST 99 não tributado (padrão do Faturador do ML)', async () => {
        const orderData = baseOrderData({
            document: '03697945000100',
            name: 'DATATECK INDUSTRIA E COMERCIO LTDA.',
            address: { street: 'Costa Gama', number: '110', neighborhood: 'Columbia City', city: 'GUAIBA', state: 'RS', zipCode: '92717330' },
        });

        const xml = await service.buildNFeXml(baseNfe(), orderData, baseIssuer());

        expect(xml).toContain('<IPI><cEnq>999</cEnq><IPITrib><CST>99</CST><vBC>100.00</vBC><pIPI>0.0000</pIPI><vIPI>0.00</vIPI></IPITrib></IPI>');
    });

    it('usa cEnq do item quando informado, em vez do default 999', async () => {
        const orderData = baseOrderData({
            document: '03697945000100',
            name: 'DATATECK INDUSTRIA E COMERCIO LTDA.',
            address: { street: 'Costa Gama', number: '110', neighborhood: 'Columbia City', city: 'GUAIBA', state: 'RS', zipCode: '92717330' },
        });
        orderData.items[0].cEnq = '123';

        const xml = await service.buildNFeXml(baseNfe(), orderData, baseIssuer());

        expect(xml).toContain('<cEnq>123</cEnq>');
    });
});
