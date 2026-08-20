import { Injectable, Inject, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CNPJ_LOOKUP_PORT, CnpjLookupPort, CnpjLookupResult } from '../ports/cnpj-lookup.port';
import { CPF_LOOKUP_PORT, CpfLookupPort, CpfLookupResult } from '../ports/cpf-lookup.port';
import { DocumentLookupAuditModel, DocumentLookupAuditDocument } from '../schemas/document-lookup-audit.schema';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface CacheEntry<T> {
    value: T;
    expiresAt: number;
}

/**
 * Fachada de consulta por documento (CPF/CNPJ), com cache in-process por TTL
 * (evita reconsulta cara/rate-limited do mesmo documento em emissões repetidas)
 * e auditoria LGPD para CPF. Ver Seção 1 da spec.
 */
@Injectable()
export class DocumentLookupService {
    private readonly logger = new Logger(DocumentLookupService.name);
    private readonly cnpjCache = new Map<string, CacheEntry<CnpjLookupResult | null>>();
    private readonly cpfCache = new Map<string, CacheEntry<CpfLookupResult | null>>();

    constructor(
        @Inject(CNPJ_LOOKUP_PORT) private readonly cnpjPort: CnpjLookupPort,
        @Inject(CPF_LOOKUP_PORT) private readonly cpfPort: CpfLookupPort,
        @InjectModel(DocumentLookupAuditModel.name)
        private readonly auditModel: Model<DocumentLookupAuditDocument>,
    ) { }

    async lookupCnpj(cnpj: string): Promise<CnpjLookupResult | null> {
        const digits = cnpj.replace(/\D/g, '');
        const cached = this.cnpjCache.get(digits);
        if (cached && cached.expiresAt > Date.now()) return cached.value;

        const result = await this.cnpjPort.lookup(digits);
        this.cnpjCache.set(digits, { value: result, expiresAt: Date.now() + CACHE_TTL_MS });
        return result;
    }

    async lookupCpf(cpf: string, birthDate: string | undefined, lookedUpBy?: string): Promise<CpfLookupResult | null> {
        const digits = cpf.replace(/\D/g, '');

        await this.auditModel.create({ document: digits, purpose: 'emissao_fiscal', lookedUpBy });

        const cached = this.cpfCache.get(digits);
        if (cached && cached.expiresAt > Date.now()) return cached.value;

        const result = await this.cpfPort.lookup(digits, birthDate);
        this.cpfCache.set(digits, { value: result, expiresAt: Date.now() + CACHE_TTL_MS });
        return result;
    }
}
