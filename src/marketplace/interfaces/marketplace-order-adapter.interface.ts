import { StandardOrder } from '../model/order.interface';

export interface IMarketplaceOrderAdapter {
    /** `params.accountId` (opcional) roteia a conta multi-client de entrada. */
    getOrders(params: any): Promise<StandardOrder[]>;
    /** `accountId` (opcional) roteia a conta multi-client que recebeu o pedido. */
    getOrderDetails(orderId: string, accountId?: string): Promise<StandardOrder>;
    updateOrderStatus(orderId: string, status: string, token?: any): Promise<any>;
    uploadInvoice?(orderId: string, xmlContent: string, options?: { packId?: string; pdfBase64?: string }): Promise<any>;
    getBillingInfo?(billingId: string, accountId?: string): Promise<any>;
}
