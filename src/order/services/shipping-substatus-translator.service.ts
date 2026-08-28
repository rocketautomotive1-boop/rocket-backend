import { Injectable } from '@nestjs/common';

/**
 * Tradução PT-BR do substatus de envio de cada marketplace, keyed por tag
 * (mesma tag usada em MarketplaceConfigCacheService/adapters). Cada marketplace
 * tem seu próprio vocabulário de substatus — não existe fonte única entre eles.
 *
 * Front nunca deve exibir substatus cru: sempre passa pelo `.translate()` aqui,
 * que devolve o substatus original como fallback se a chave não for conhecida
 * (evita quebrar a tela quando o marketplace introduz um substatus novo).
 */
@Injectable()
export class ShippingSubstatusTranslatorService {
    private readonly labelsByMarketplace: Record<string, Record<string, string>> = {
        mercadolivre: {
            // pending
            buffered: 'Aguardando coleta / envio',
            invoice_pending: 'Aguardando nota fiscal',

            // ready_to_ship / handling
            shipment_paid: 'Envio pago',
            ready_to_print: 'Pronto para imprimir',
            printed: 'Etiqueta impressa',
            picked_up: 'Coletado',
            in_packing_list: 'Incluído em lista de coleta',
            invoiced: 'Nota fiscal emitida',
            in_warehouse: 'Recebido no armazém',

            // shipped
            in_hub: 'Em trânsito (hub)',
            in_transit: 'Em trânsito',
            out_for_delivery: 'Saiu para entrega',
            receiver_absent: 'Destinatário ausente',
            returning_to_sender: 'Retornando ao remetente',
            delayed: 'Envio atrasado',
            delivery_failed_pdd: 'Falha na entrega (agência)',
            waiting_for_confirmation: 'Aguardando confirmação de entrega',
            waiting_for_withdrawal: 'Aguardando retirada',

            // delivered / not_delivered
            delivered: 'Entregue',
            not_delivered: 'Não entregue',
            claimed: 'Reclamado pelo comprador',

            // cancelled
            cancelled: 'Envio cancelado',
        },
        // shopee/tiktokshop/amazon: hoje os adapters normalizam direto pro status
        // interno unificado (PENDING/PAID/SHIPPED/...) sem expor substatus granular
        // de shipping. Adicionar aqui se/quando a tela de detalhes passar a exibi-los.
    };

    translate(marketplaceTag: string, substatus?: string | null): string | undefined {
        if (!substatus) return undefined;
        const tag = (marketplaceTag || '').toLowerCase();
        return this.labelsByMarketplace[tag]?.[substatus] || substatus;
    }
}
