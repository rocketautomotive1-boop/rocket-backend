import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ORDER_EVENTS, OrderReadyToShipEvent } from '../../order/events/order.events';
import { FiscalIssuanceRequestService } from '../services/fiscal-issuance-request.service';

/**
 * Ponte order → fiscal. Importa SOMENTE o tipo do evento de order/events (nunca
 * OrderModule), mesma disciplina de import que OrderNotificationTranslator já pratica.
 * Dispara auto-emissão de NFe quando o pedido é fisicamente separado (picking
 * concluído) — não na ingestão do pedido, que é cedo demais em muitos regimes fiscais.
 */
@Injectable()
export class FiscalIssuanceOrderListener {
    private readonly logger = new Logger(FiscalIssuanceOrderListener.name);

    constructor(private readonly issuanceRequest: FiscalIssuanceRequestService) { }

    @OnEvent(ORDER_EVENTS.READY_TO_SHIP, { async: true })
    async onReadyToShip(event: OrderReadyToShipEvent): Promise<void> {
        try {
            await this.issuanceRequest.request(event.orderId, { environment: 'PRODUCTION' });
        } catch (err) {
            // Store/LegalEntity/FiscalChannel ausente é esperado durante rollout incremental
            // (nem toda conta tem canal fiscal configurado ainda) — loga e segue, não é uma
            // falha do fulfillment. Emissão fiscal é efeito colateral do picking concluído,
            // nunca uma precondição dele.
            this.logger.warn(`Auto-emissão de NFe pulada para pedido ${event.orderId}: ${err.message}`);
        }
    }
}
