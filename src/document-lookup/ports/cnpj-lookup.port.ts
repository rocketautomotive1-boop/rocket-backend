export interface CnpjLookupAddress {
    street: string;
    number: string;
    neighborhood: string;
    city: string;
    state: string;
    zipCode: string;
}

export interface CnpjLookupResult {
    cnpj: string;
    companyName: string;
    fantasyName?: string;
    address: CnpjLookupAddress;
    ie?: string;
    situacao: 'ATIVA' | 'INATIVA' | 'SUSPENSA' | 'BAIXADA';
    icmsEnabled?: boolean;
}

export const CNPJ_LOOKUP_PORT = Symbol('CNPJ_LOOKUP_PORT');

export interface CnpjLookupPort {
    lookup(cnpj: string): Promise<CnpjLookupResult | null>;
}
