import { Injectable, Logger, NotImplementedException, OnModuleInit } from '@nestjs/common';
import { IMarketplaceOrderAdapter } from '../../interfaces/marketplace-order-adapter.interface';
import { StandardOrder } from '../../model/order.interface';
import { MarketplaceAdapterRegistry } from '../../registries/marketplace-adapter.registry';

/**
 * STUB: os endpoints reais de pedidos do Magalu (/seller/v1/orders,
 * /seller/v1/deliveries, /seller/v1/invoices — nomes prováveis, a confirmar)
 * ainda não foram documentados nesta integração. O client já tem os scopes
 * necessários (open:order-order-seller:read, order-delivery-seller:*,
 * order-invoice-seller:read), mas payloads/paths de request e response não
 * foram fornecidos — implementar aqui exigiria inventar um contrato que
 * quebraria silenciosamente contra a API real.
 *
 * O adapter SE REGISTRA corretamente (para não quebrar o broker/discovery)
 * mas cada método lança NotImplementedException com uma mensagem acionável.
 */
@Injectable()
export class MagaluOrderAdapter implements IMarketplaceOrderAdapter, OnModuleInit {
  private readonly logger = new Logger(MagaluOrderAdapter.name);
  private name = 'Magalu';

  constructor(private readonly registry: MarketplaceAdapterRegistry) {}

  onModuleInit() {
    this.registry.registerOrderAdapter(this.name, this);
  }

  private notImplemented(method: string): never {
    const msg = `MagaluOrderAdapter.${method}: endpoint de pedidos ainda não documentado nesta integração.`;
    this.logger.error(msg);
    throw new NotImplementedException(msg);
  }

  async getOrders(_params: any): Promise<StandardOrder[]> {
    this.notImplemented('getOrders');
  }

  async getOrderDetails(_orderId: string, _accountId?: string): Promise<StandardOrder> {
    this.notImplemented('getOrderDetails');
  }

  async updateOrderStatus(_orderId: string, _status: string, _token?: any): Promise<any> {
    this.notImplemented('updateOrderStatus');
  }
}
