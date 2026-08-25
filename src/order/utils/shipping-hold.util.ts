import { BadRequestException } from '@nestjs/common';

/**
 * Envio Programado (ML) — enquanto `shipping.scheduledShippingDate` estiver no
 * futuro, o vendedor não pode emitir NF-e nem imprimir etiqueta para o pedido
 * (o próprio ML bloqueia o envio antes dessa data). Lança 400 se ainda estiver
 * dentro do prazo; não faz nada se a data for nula/passada.
 */
export function assertShippingReleased(order: { shipping?: { scheduledShippingDate?: Date | string | null } }): void {
    const scheduledShippingDate = order.shipping?.scheduledShippingDate;
    if (!scheduledShippingDate) return;

    const date = new Date(scheduledShippingDate);
    if (date > new Date()) {
        throw new BadRequestException(
            `Este pedido tem envio programado para ${date.toLocaleDateString('pt-BR')}. ` +
            `NF-e e etiqueta só podem ser emitidas a partir dessa data.`,
        );
    }
}
