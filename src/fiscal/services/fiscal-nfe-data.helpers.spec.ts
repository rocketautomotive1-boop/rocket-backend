import { mapMarketplacePayments, enrichItemWithProductData } from './fiscal-nfe-data.helpers';

describe('mapMarketplacePayments', () => {
    it('mapeia todos os pagamentos aprovados, preservando authorizationCode e amount de cada um', () => {
        const payments = mapMarketplacePayments([
            { status: 'approved', payment_method_id: 'master', payment_type: 'credit_card', authorization_code: '681582', transaction_amount: 234.5 },
            { status: 'approved', payment_method_id: 'master', payment_type: 'credit_card', authorization_code: '681520', transaction_amount: 265.5 },
        ]);

        expect(payments).toEqual([
            { paymentMethodId: 'master', paymentType: 'credit_card', authorizationCode: '681582', installments: 1, amount: 234.5 },
            { paymentMethodId: 'master', paymentType: 'credit_card', authorizationCode: '681520', installments: 1, amount: 265.5 },
        ]);
    });

    it('ignora pagamentos não aprovados (cancelados/rejeitados)', () => {
        const payments = mapMarketplacePayments([
            { status: 'rejected', payment_method_id: 'visa', payment_type: 'credit_card', authorization_code: 'X', transaction_amount: 100 },
            { status: 'approved', payment_method_id: 'pix', payment_type: 'bank_transfer', authorization_code: 'PIXE123', transaction_amount: 50 },
        ]);

        expect(payments).toEqual([
            { paymentMethodId: 'pix', paymentType: 'bank_transfer', authorizationCode: 'PIXE123', installments: 1, amount: 50 },
        ]);
    });

    it('retorna array vazio quando não há pagamentos aprovados', () => {
        const payments = mapMarketplacePayments([
            { status: 'rejected', payment_method_id: 'visa', payment_type: 'credit_card', authorization_code: 'X', transaction_amount: 100 },
        ]);

        expect(payments).toEqual([]);
    });

    it('retorna array vazio quando a lista de pagamentos é vazia ou ausente', () => {
        expect(mapMarketplacePayments([])).toEqual([]);
        expect(mapMarketplacePayments(undefined)).toEqual([]);
    });
});

describe('enrichItemWithProductData', () => {
    it('propaga weight do produto para o item (grupo vol/transp da NFe)', () => {
        const item: any = { id: 'p1', quantity: 1, unit_price: 100 };
        const product: any = { ncm: { code: '87089990' }, weight: 1.48 };

        enrichItemWithProductData(item, product);

        expect(item.weight).toBe(1.48);
    });

    it('não sobrescreve weight já presente no item quando o produto não tem weight', () => {
        const item: any = { id: 'p1', quantity: 1, unit_price: 100, weight: 2 };
        const product: any = { ncm: { code: '87089990' } };

        enrichItemWithProductData(item, product);

        expect(item.weight).toBe(2);
    });
});
