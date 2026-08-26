import { BadRequestException } from '@nestjs/common';

/**
 * Prazo de expedição (ML) — enquanto o shipment estiver em `status: 'pending'` +
 * `substatus: 'buffered'`, o vendedor não pode emitir NF-e nem imprimir etiqueta
 * (o próprio ML não libera a etiqueta nesse estado — é o "Para enviar em X" do
 * painel deles). Testado ao vivo: `shipping_option.buffering.date` tem só a chave
 * `date` (sem enum próprio) e é usado apenas para compor a mensagem — o estado
 * real e autoritativo é o par status/substatus, não a data (evita comparação de
 * data frágil a fuso/DST). Lança 400 se ainda em buffer; não faz nada fora dele.
 */
export function assertShippingReleased(order: {
    shipping?: {
        status?: string | null;
        substatus?: string | null;
        scheduledShippingDate?: Date | string | null;
    };
}): void {
    const shipping = order.shipping;
    if (shipping?.status !== 'pending' || shipping?.substatus !== 'buffered') return;

    const scheduledShippingDate = shipping.scheduledShippingDate;
    const dateMessage = scheduledShippingDate
        ? ` Para enviar em ${new Date(scheduledShippingDate).toLocaleDateString('pt-BR')}.`
        : '';
    throw new BadRequestException(
        `Este pedido ainda está no prazo de expedição do Mercado Livre.${dateMessage} ` +
        `NF-e e etiqueta só podem ser emitidas quando o Mercado Livre liberar o envio.`,
    );
}
