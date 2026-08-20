import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { IMarketplaceOrderAdapter } from '../../interfaces/marketplace-order-adapter.interface';
import { MarketplaceAdapterRegistry } from '../../registries/marketplace-adapter.registry';
import {
    BalcaoOrderDraftModel,
    BalcaoOrderDraftDocument,
} from '../../../order/schemas/balcao-order-draft.schema';

/**
 * Order adapter do marketplace interno "Rocket" — cobre venda balcão (loja física).
 * Não faz nenhuma chamada de rede: getOrderDetails lê o rascunho gravado por
 * POST /orders/balcao e o devolve no formato StandardOrder esperado pelo pipeline.
 * getOrders não é usado (balcão não entra por reconcile/polling — só push explícito).
 */
@Injectable()
export class RocketOrderAdapter implements IMarketplaceOrderAdapter, OnModuleInit {
    private readonly logger = new Logger(RocketOrderAdapter.name);
    private readonly name = 'Rocket';

    constructor(
        private readonly registry: MarketplaceAdapterRegistry,
        @InjectModel(BalcaoOrderDraftModel.name)
        private readonly draftModel: Model<BalcaoOrderDraftDocument>,
    ) { }

    onModuleInit() {
        this.registry.registerOrderAdapter(this.name, this);
    }

    async getOrders(): Promise<any[]> {
        return [];
    }

    async getOrderDetails(externalId: string): Promise<any> {
        const draft = await this.draftModel.findOne({ externalId, status: 'pending' });
        if (!draft) {
            throw new NotFoundException(`Rascunho de pedido balcão não encontrado: ${externalId}`);
        }

        const items = draft.data.items.map(i => ({
            id: i.productId,
            sku: i.productId, // ObjectId válido → resolvido direto (Strategy 0 do ProductMatcherService)
            title: i.title || '',
            quantity: i.quantity,
            unit_price: i.unitPrice,
        }));
        const total_amount = items.reduce((sum, i) => sum + i.quantity * i.unit_price, 0);

        await draft.updateOne({ status: 'processed' });
        this.logger.log(`Pedido balcão ${externalId} lido do rascunho (${items.length} itens)`);

        return {
            id: externalId,
            marketplaceName: this.name,
            // 'paid' está em CONFIRMED_STATUSES (order-ingest.decision.ts) — venda balcão já
            // nasce paga (cliente paga no ato), então entra direto como CREATE_DEDUCT.
            status: 'paid',
            date_created: new Date().toISOString(),
            total_amount,
            items,
        };
    }

    async updateOrderStatus(): Promise<any> {
        return null;
    }
}
