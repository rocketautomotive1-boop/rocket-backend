export const FISCAL_EVENTS = {
    NFE_AUTHORIZED: 'fiscal.nfe.authorized',
    NFE_REJECTED: 'fiscal.nfe.rejected',
    NFE_ISSUANCE_STUCK: 'fiscal.nfe.issuance.stuck',
    NFE_CANCELLED: 'fiscal.nfe.cancelled',
    /** DANFE (PDF) gerado e disponível em S3 — gatilho do e-mail transacional ao cliente
     *  (que prefere receber XML+PDF juntos, não só o XML). Ver FiscalDanfeService. */
    DANFE_READY: 'fiscal.danfe.ready',
    /** Geração do DANFE falhou — fallback para o e-mail sair mesmo sem PDF (o XML já é
     *  o documento fiscal oficial; não faz sentido o cliente nunca receber nada). */
    DANFE_FAILED: 'fiscal.danfe.failed',
};

/** Emitido quando uma NFe é autorizada pela SEFAZ. Payload autocontido — consumidores
 *  (DANFE, notificação, e-mail futuro) não precisam reconsultar FiscalDocument/Order. */
export class FiscalNfeAuthorizedEvent {
    constructor(
        public readonly nfeId: string,
        public readonly orderId: string | null,
        public readonly storeId: string | null,
        public readonly accessKey: string,
        public readonly series: number,
        public readonly number: number,
        public readonly xml: string,
        public readonly customerEmail?: string,
        public readonly customerName?: string,
    ) { }
}

export class FiscalNfeRejectedEvent {
    constructor(
        public readonly nfeId: string,
        public readonly orderId: string | null,
        public readonly rejectionReason: string,
    ) { }
}

export class FiscalNfeIssuanceStuckEvent {
    constructor(
        public readonly orderId: string,
        public readonly attempts: number,
        public readonly lastError: string,
    ) { }
}

export class FiscalNfeCancelledEvent {
    constructor(
        public readonly nfeId: string,
        public readonly orderId: string | null,
        public readonly accessKey: string,
        public readonly justification: string,
    ) { }
}

/** Emitido por FiscalDanfeService quando o PDF é gerado com sucesso. Payload
 *  autocontido (repete os dados de FiscalNfeAuthorizedEvent + a URL do PDF) para
 *  que o consumidor de e-mail não precise reconsultar FiscalDocument. */
export class FiscalDanfeReadyEvent {
    constructor(
        public readonly nfeId: string,
        public readonly orderId: string | null,
        public readonly accessKey: string,
        public readonly series: number,
        public readonly number: number,
        public readonly xml: string,
        public readonly danfeUrl: string,
        public readonly customerEmail?: string,
        public readonly customerName?: string,
    ) { }
}
