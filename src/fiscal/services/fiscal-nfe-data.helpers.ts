/** Mapeia payments[] de um pedido de marketplace (já normalizado pelo adapter) para o
 *  formato consumido por XmlBuilderService.buildDetPag — um <detPag> por pagamento
 *  aprovado, preservando authorizationCode individual (necessário para múltiplos
 *  pagamentos no mesmo pedido, ex.: parcelado em dois cartões). */
export function mapMarketplacePayments(payments: any[] | undefined): any[] {
    return (payments || [])
        .filter((p) => p?.status === 'approved')
        .map((p) => ({
            paymentMethodId: p.payment_method_id,
            paymentType: p.payment_type,
            authorizationCode: p.authorization_code,
            installments: p.installments || 1,
            amount: p.transaction_amount,
        }));
}

/** Propaga peso do produto interno para o item do pedido — usado no grupo transp/vol
 *  da NFe (declarado só quando o marketplace contrata o transporte, ex.: Mercado Envios). */
export function enrichItemWithProductData(item: any, product: any): void {
    item.weight = product.weight ?? item.weight;
}
