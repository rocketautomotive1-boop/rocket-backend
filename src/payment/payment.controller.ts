import { Controller, Post, Body, Query, Headers, Logger, HttpCode } from '@nestjs/common';
import { MercadoPagoCheckoutService } from '../mercado-pago/mercado-pago-checkout.service';
import { OrderLifecycleService } from '../order/lifecycle/order-lifecycle.service';

@Controller('payments')
export class PaymentController {
    private readonly logger = new Logger(PaymentController.name);

    constructor(
        private readonly mercadoPago: MercadoPagoCheckoutService,
        private readonly orderLifecycle: OrderLifecycleService,
    ) { }

    /**
     * Webhook de notificação do Mercado Pago (payment.created/payment.updated).
     * MP manda tanto `?type=payment&data.id=X` (query) quanto body JSON `{type, data:{id}}`
     * dependendo da configuração — aceitamos os dois formatos.
     *
     * Responde 200 sempre e rápido (processamento é síncrono aqui pois é leve: 1 GET + 1 update),
     * seguindo a convenção do projeto de nunca deixar o marketplace/PSP retentar por timeout.
     */
    @Post('webhook')
    @HttpCode(200)
    async handleWebhook(
        @Body() body: any,
        @Query() query: any,
        @Headers('x-signature') signature: string,
        @Headers('x-request-id') requestId: string,
    ) {
        const type = body?.type || query?.type;
        const dataId = body?.data?.id || query?.['data.id'];

        if (type !== 'payment' || !dataId) {
            return { received: true, ignored: true };
        }

        const validSignature = await this.mercadoPago.verifyWebhookSignature(signature, requestId, String(dataId));
        if (!validSignature) {
            this.logger.warn(`Assinatura inválida no webhook MP para payment ${dataId} — ignorando.`);
            return { received: true, ignored: true };
        }

        try {
            const payment = await this.mercadoPago.getPayment(dataId);
            const result = await this.orderLifecycle.confirmPaymentByMpId(String(payment.id), payment.status);
            if (!result.isSuccess) {
                this.logger.warn(`Webhook MP: ${result.error}`);
            }
        } catch (error) {
            this.logger.error(`Erro ao processar webhook MP para payment ${dataId}: ${error.message}`);
        }

        return { received: true };
    }
}
