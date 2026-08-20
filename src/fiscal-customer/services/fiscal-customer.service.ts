import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { FiscalCustomerModel, FiscalCustomerDocument, FiscalCustomerAddress } from '../schemas/fiscal-customer.schema';

export interface FiscalCustomerUpsertInput {
    document: string;
    documentType: 'CPF' | 'CNPJ';
    name: string;
    ie?: string;
    ieIndicator?: 'CONTRIBUTOR' | 'EXEMPT' | 'NON_CONTRIBUTOR';
    email?: string;
    phone?: string;
    address?: FiscalCustomerAddress;
}

@Injectable()
export class FiscalCustomerService {
    private readonly logger = new Logger(FiscalCustomerService.name);

    constructor(
        @InjectModel(FiscalCustomerModel.name)
        private readonly fiscalCustomerModel: Model<FiscalCustomerDocument>,
    ) { }

    async findByDocument(document: string): Promise<FiscalCustomerDocument | null> {
        const digits = document.replace(/\D/g, '');
        if (!digits) return null;
        return this.fiscalCustomerModel.findOne({ document: digits }).exec();
    }

    async list(query: string | undefined, limit = 50): Promise<FiscalCustomerDocument[]> {
        const filter: any = {};
        if (query?.trim()) {
            const digits = query.replace(/\D/g, '');
            filter.$or = [
                { document: { $regex: digits || query, $options: 'i' } },
                { name: { $regex: query, $options: 'i' } },
            ];
        }
        return this.fiscalCustomerModel.find(filter).sort({ lastUsedAt: -1 }).limit(limit).exec();
    }

    /** Cria ou atualiza o cadastro por documento, incrementando ordersCount. Não
     *  sobrescreve dados existentes sem que o chamador explicitamente os informe. */
    async upsert(input: FiscalCustomerUpsertInput): Promise<FiscalCustomerDocument> {
        const digits = input.document.replace(/\D/g, '');
        const existing = await this.fiscalCustomerModel.findOne({ document: digits }).exec();

        if (existing) {
            existing.name = input.name || existing.name;
            existing.ie = input.ie ?? existing.ie;
            existing.ieIndicator = input.ieIndicator ?? existing.ieIndicator;
            existing.email = input.email ?? existing.email;
            existing.phone = input.phone ?? existing.phone;
            if (input.address) {
                const alreadyPresent = existing.addresses.some((a) =>
                    a.street === input.address!.street && a.number === input.address!.number && a.zipCode === input.address!.zipCode,
                );
                if (!alreadyPresent) existing.addresses = [...existing.addresses, input.address];
            }
            existing.lastUsedAt = new Date();
            existing.ordersCount += 1;
            await existing.save();
            return existing;
        }

        return this.fiscalCustomerModel.create({
            document: digits,
            documentType: input.documentType,
            name: input.name,
            ie: input.ie,
            ieIndicator: input.ieIndicator || 'NON_CONTRIBUTOR',
            email: input.email,
            phone: input.phone,
            addresses: input.address ? [input.address] : [],
            lastUsedAt: new Date(),
            ordersCount: 1,
        });
    }

    /** Atualização manual (tela de gerenciamento) — não incrementa ordersCount. */
    async update(document: string, data: Partial<FiscalCustomerUpsertInput>): Promise<FiscalCustomerDocument | null> {
        const digits = document.replace(/\D/g, '');
        return this.fiscalCustomerModel.findOneAndUpdate(
            { document: digits },
            { $set: data },
            { new: true },
        ).exec();
    }
}
