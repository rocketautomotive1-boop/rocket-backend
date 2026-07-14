import { Injectable, BadRequestException } from '@nestjs/common';
import { MercadoPagoCheckoutService } from '../mercado-pago/mercado-pago-checkout.service';

export interface ProcessPaymentInput {
    amount: number;
    method: string; // 'credit_card' | 'pix' | 'boleto'
    cardData?: { token: string; installments: number; paymentMethodId: string; issuerId?: string };
    payer: { email: string; name?: string; document?: string };
    externalReference: string;
}

export interface ProcessPaymentResult {
    status: 'approved' | 'pending' | 'in_process' | 'rejected';
    transactionId: string;
    message?: string;
    qrCode?: string;
    qrCodeBase64?: string;
    ticketUrl?: string;
}

@Injectable()
export class PaymentService {
    constructor(private readonly mercadoPago: MercadoPagoCheckoutService) { }

    async processPayment(input: ProcessPaymentInput): Promise<ProcessPaymentResult> {
        switch (input.method) {
            case 'credit_card': {
                if (!input.cardData?.token) {
                    throw new BadRequestException('Token do cartão é obrigatório (gerado pelo Payment Brick no frontend).');
                }
                const result = await this.mercadoPago.createCardPayment({
                    amount: input.amount,
                    token: input.cardData.token,
                    installments: input.cardData.installments,
                    paymentMethodId: input.cardData.paymentMethodId,
                    issuerId: input.cardData.issuerId,
                    payer: { email: input.payer.email, document: input.payer.document },
                    description: 'Compra Rocket Automotive',
                    externalReference: input.externalReference,
                });
                return this.mapStatus(result);
            }
            case 'pix': {
                const result = await this.mercadoPago.createPixPayment({
                    amount: input.amount,
                    payer: { email: input.payer.email, name: input.payer.name, document: input.payer.document },
                    description: 'Compra Rocket Automotive',
                    externalReference: input.externalReference,
                });
                return { ...this.mapStatus(result), qrCode: result.qrCode, qrCodeBase64: result.qrCodeBase64 };
            }
            case 'boleto': {
                if (!input.payer.document || !input.payer.name) {
                    throw new BadRequestException('Nome e CPF/CNPJ são obrigatórios para pagamento via boleto.');
                }
                const result = await this.mercadoPago.createBoletoPayment({
                    amount: input.amount,
                    payer: { email: input.payer.email, name: input.payer.name, document: input.payer.document },
                    description: 'Compra Rocket Automotive',
                    externalReference: input.externalReference,
                });
                return { ...this.mapStatus(result), ticketUrl: result.ticketUrl };
            }
            default:
                throw new BadRequestException(`Método de pagamento não suportado: ${input.method}`);
        }
    }

    private mapStatus(result: { id: number; status: string; statusDetail: string }): ProcessPaymentResult {
        const status = result.status === 'approved' ? 'approved'
            : result.status === 'rejected' ? 'rejected'
                : result.status === 'in_process' ? 'in_process'
                    : 'pending';

        return {
            status,
            transactionId: String(result.id),
            message: status === 'rejected' ? this.rejectionMessage(result.statusDetail) : undefined,
        };
    }

    private rejectionMessage(statusDetail: string): string {
        const messages: Record<string, string> = {
            cc_rejected_insufficient_amount: 'Saldo insuficiente no cartão.',
            cc_rejected_bad_filled_card_number: 'Número do cartão inválido.',
            cc_rejected_bad_filled_date: 'Data de validade inválida.',
            cc_rejected_bad_filled_security_code: 'CVV inválido.',
            cc_rejected_call_for_authorize: 'Pagamento não autorizado pelo banco emissor.',
            cc_rejected_card_disabled: 'Cartão desabilitado — contate o banco emissor.',
            cc_rejected_high_risk: 'Pagamento recusado por análise de risco.',
        };
        return messages[statusDetail] || 'Pagamento recusado pela operadora.';
    }
}
