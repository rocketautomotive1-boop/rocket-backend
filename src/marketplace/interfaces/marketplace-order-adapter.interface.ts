import { StandardOrder } from '../model/order.interface';

export interface IMarketplaceOrderAdapter {
    getOrders(params: any): Promise<StandardOrder[]>;
    getOrderDetails(orderId: string, token?: any): Promise<StandardOrder>;
    updateOrderStatus(orderId: string, status: string, token?: any): Promise<any>;
    uploadInvoice?(orderId: string, xmlContent: string): Promise<any>;
    getBillingInfo?(billingId: string): Promise<any>;
}
