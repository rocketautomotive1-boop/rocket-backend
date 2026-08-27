import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { RabbitSubscribe, MessageHandlerErrorBehavior } from '@golevelup/nestjs-rabbitmq';
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
 * Fila de espera: mensagens dead-lettered aqui ficam RETRY_DELAY_MS e voltam
 * sozinhas pra fila principal (seu próprio dead-letter aponta pro exchange
 * original) — implementa o backoff sem consumer nenhum ligado nela.
 * Usa o exchange rocket.fiscal.dlx (já declarado em rabbitmq.module.ts,
 * antes órfão — nada estava ligado nele) em vez do exchange default do
 * RabbitMQ (nome '', não pode ser declarado explicitamente via API).
 */
const FISCAL_DLX_EXCHANGE = 'rocket.fiscal.dlx';
const RETRY_QUEUE = 'q.fiscal.issuance.retry';
const RETRY_ROUTING_KEY = 'nfe.emit.retry';
const RETRY_DELAY_MS = Number(process.env.FISCAL_ISSUANCE_RETRY_DELAY_MS) || 30_000;

/**
 * Consome pedidos de emissão de NFe enfileirados por FiscalIssuanceRequestService.
 * Erro de CONFIGURAÇÃO (Store/LegalEntity/FiscalChannel ausente) não é retryable —
 * relançar não resolveria nada, só reprocessaria o mesmo erro indefinidamente. Erro de
 * TRANSPORTE (timeout SEFAZ, rede) relança para dead-letter → fila de espera (TTL) →
 * volta pra esta fila depois de RETRY_DELAY_MS.
 *
 * IMPORTANTE: `errorBehavior: NACK` é obrigatório aqui — o default da lib
 * (`defaultSubscribeErrorBehavior`) é REQUEUE, que reentrega na MESMA fila
 * instantaneamente (sem passar pelo dead-letter), causando loop de retry em
 * ~1-2s independente de qualquer TTL/DLX configurado na fila. Foi exatamente
 * esse o mecanismo do incidente em produção (pedido 2000018139210232: 18.103
 * logs idênticos em ~15min, documento inflado a ~5MB, app travando ao abrir
 * o pedido). NACK sem requeue é o único jeito de o dead-letter da fila entrar
 * em ação.
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
        queueOptions: {
            durable: true,
            deadLetterExchange: FISCAL_DLX_EXCHANGE,
            deadLetterRoutingKey: RETRY_ROUTING_KEY,
        },
        errorBehavior: MessageHandlerErrorBehavior.NACK,
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

            const attempts = (amqpMsg?.properties?.headers?.['x-death']?.[0]?.count ?? 0) + 1;
            if (attempts >= MAX_DELIVERY_ATTEMPTS) {
                this.logger.error(`Emissão de NFe para pedido ${msg.orderId} esgotou tentativas (${attempts}): ${err.message}`);
                this.eventEmitter.emit(
                    FISCAL_EVENTS.NFE_ISSUANCE_STUCK,
                    new FiscalNfeIssuanceStuckEvent(msg.orderId, attempts, err.message),
                );
                return; // não relança — evita reentrar no ciclo de retry além do limite
            }

            this.logger.warn(`Falha de transporte na emissão de NFe (tentativa ${attempts}/${MAX_DELIVERY_ATTEMPTS}) para pedido ${msg.orderId}: ${err.message}`);
            throw err; // NACK sem requeue → dead-letter → fila de espera (RETRY_DELAY_MS) → volta aqui
        }
    }

    /**
     * Fila de espera pura — nenhum consumer processa mensagens daqui. Ela só existe
     * para aplicar o TTL antes de devolver a mensagem para `q.fiscal.issuance`
     * (via seu próprio deadLetterExchange/deadLetterRoutingKey, configurados
     * acima em queueOptions). Declarada via @RabbitSubscribe só para garantir a
     * criação/binding da fila no boot — nunca deve receber handler real.
     */
    @RabbitSubscribe({
        exchange: FISCAL_DLX_EXCHANGE,
        routingKey: RETRY_ROUTING_KEY,
        queue: RETRY_QUEUE,
        queueOptions: {
            durable: true,
            messageTtl: RETRY_DELAY_MS,
            deadLetterExchange: FISCAL_ISSUANCE_EXCHANGE,
            deadLetterRoutingKey: FISCAL_ISSUANCE_ROUTING_KEY,
        },
        errorBehavior: MessageHandlerErrorBehavior.NACK,
    })
    private async neverConsume(): Promise<void> {
        // Nunca deveria ser chamado — mensagens na fila de espera só saem por TTL
        // expirado (dead-letter automático), não por consumo. Se isto disparar,
        // algo está publicando direto na fila de espera fora do fluxo de retry.
        this.logger.error('[fiscal.issuance.retry] Consumo inesperado na fila de espera — investigar.');
    }
}
