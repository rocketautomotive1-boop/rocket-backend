export interface CpfLookupAddress {
    street: string;
    number: string;
    neighborhood: string;
    city: string;
    state: string;
    zipCode: string;
}

export interface CpfLookupResult {
    cpf: string;
    name: string;
    address?: CpfLookupAddress;
    situacao: 'REGULAR' | 'IRREGULAR' | 'SUSPENSO' | 'CANCELADO';
}

export const CPF_LOOKUP_PORT = Symbol('CPF_LOOKUP_PORT');

export interface CpfLookupPort {
    lookup(cpf: string, birthDate?: string): Promise<CpfLookupResult | null>;
}
