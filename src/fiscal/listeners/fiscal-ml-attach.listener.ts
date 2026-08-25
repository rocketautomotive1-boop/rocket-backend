import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { OrderModel, OrderDocument } from '../../order/schemas/order.schema';
import { MarketplaceRegistryService } from '../../marketplace/services/marketplace-registry.service';
import { MarketplaceOrderService } from '../../marketplace/services/marketplace-order.service';
import { FISCAL_EVENTS, FiscalNfeAuthorizedEvent } from '../events/fiscal.events';

const MERCADO_LIVRE_TAG = 'mercadolivre';

/**
 * Anexa a NFe autorizada ao pedido no Mercado Livre automaticamente — sem isso, a
 * nota fica emitida no backend mas o operador precisa entrar em cada pedido e clicar
 * em "Enviar ao Marketplace" manualmente para liberar a etiqueta. Consumidor
 * independente do evento de emissão: falha aqui nunca deve derrubar a emissão, que
 * já está autorizada e válida perante a SEFAZ mesmo sem o anexo no marketplace (o
 * operador ainda pode enviar manualmente pela tela do pedido).
 */
@Injectable()
export class FiscalMlAttachListener {
    private readonly logger = new Logger(FiscalMlAttachListener.name);

    constructor(
        @InjectModel(OrderModel.name)
        private readonly orderModel: Model<OrderDocument>,
        private readonly registryService: MarketplaceRegistryService,
        private readonly marketplaceOrderService: MarketplaceOrderService,
    ) { }

    @OnEvent(FISCAL_EVENTS.NFE_AUTHORIZED, { async: true })
    async onAuthorized(event: FiscalNfeAuthorizedEvent): Promise<void> {
        if (!event.orderId) return; // NFe avulsa — não vinculada a um pedido de marketplace

        try {
            const order = await this.orderModel.findById(event.orderId).lean().exec();
            if (!order) return;

            const marketplace = await this.registryService.findOne(String(order.marketplaceId));
            if (!marketplace || marketplace.tag !== MERCADO_LIVRE_TAG) return;

            await this.marketplaceOrderService.attachFiscalDocument(
                order.externalId,
                String(order.marketplaceId),
                event.xml,
                { packId: order.packId, accountId: order.accountId },
            );
            this.logger.log(`NFe ${event.nfeId} anexada ao pedido ML ${order.externalId}`);
        } catch (err) {
            this.logger.warn(`Falha ao anexar NFe ${event.nfeId} ao Mercado Livre: ${err.message}`);
        }
    }
}
