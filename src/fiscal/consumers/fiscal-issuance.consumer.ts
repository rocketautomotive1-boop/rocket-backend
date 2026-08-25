import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FiscalService } from '../services/fiscal.service';
import { FISCAL_ISSUANCE_EXCHANGE, FISCAL_ISSUANCE_ROUTING_KEY } from '../services/fiscal-issuance-request.service';
import { FISCAL_EVENTS, FiscalNfeIssuanceStuckEvent } from '../events/fiscal.events';

interface FiscalIssuanceRequestedMessage {
    orderId: string;
    overrides: any;
    requestedAt: string;
}

const MAX_DELIVERY_ATTEMPTS = Number(process.env.FISCAL_ISSUANCE_MAX_ATTEMPTS) || 5;

/**
 * Consome pedidos de emissão de NFe enfileirados por FiscalIssuanceRequestService.
 * Erro de CONFIGURAÇÃO (Store/LegalEntity/FiscalChannel ausente) não é retryable —
 * relançar não resolveria nada, só reprocessaria o mesmo erro indefinidamente. Erro de
 * TRANSPORTE (timeout SEFAZ, rede) relança para o RabbitMQ redeleta via retry nativo
 * (política de TTL+DLQ na fila, configurada na infra de deploy).
 */
@Injectable()
export class FiscalIssuanceConsumer {
    private readonly logger = new Logger(FiscalIssuanceConsumer.name);

    constructor(
        private readonly fiscalService: FiscalService,
        private readonly eventEmitter: EventEmitter2,
    ) { }

    @RabbitSubscribe({
        exchange: FISCAL_ISSUANCE_EXCHANGE,
        routingKey: FISCAL_ISSUANCE_ROUTING_KEY,
        queue: 'q.fiscal.issuance',
        queueOptions: { durable: true },
    })
    async handle(msg: FiscalIssuanceRequestedMessage, amqpMsg: any): Promise<void> {
        this.logger.log(`Processando emissão de NFe para pedido ${msg.orderId}`);
        try {
            await this.fiscalService.emitNFe(msg.orderId, msg.overrides || {});
        } catch (err) {
            // FiscalService.emitNFe já persiste o FiscalDocument em ERROR e emite
            // FISCAL_EVENTS.NFE_ERROR antes de relançar (mesmo para erros de config
            // como resolveFiscalContext, que agora rodam dentro do try de emitNFe) —
            // o consumer não precisa (nem deve) duplicar essa notificação.
            if (err instanceof NotFoundException || err instanceof BadRequestException) {
                // Erro de configuração/negócio — não é recuperável por retry automático.
                this.logger.warn(`Emissão de NFe pulada para pedido ${msg.orderId} (não recuperável): ${err.message}`);
                return;
            }

            const attempts = (amqpMsg?.fields?.['x-death']?.[0]?.count ?? 0) + 1;
            if (attempts >= MAX_DELIVERY_ATTEMPTS) {
                this.logger.error(`Emissão de NFe para pedido ${msg.orderId} esgotou tentativas (${attempts}): ${err.message}`);
                this.eventEmitter.emit(
                    FISCAL_EVENTS.NFE_ISSUANCE_STUCK,
                    new FiscalNfeIssuanceStuckEvent(msg.orderId, attempts, err.message),
                );
                return; // não relança — evita loop infinito de redelivery além do limite
            }

            this.logger.warn(`Falha de transporte na emissão de NFe (tentativa ${attempts}) para pedido ${msg.orderId}: ${err.message}`);
            throw err; // NACK → RabbitMQ redeleta
        }
    }
}
