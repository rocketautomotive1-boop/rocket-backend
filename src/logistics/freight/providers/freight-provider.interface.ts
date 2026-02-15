import { Injectable } from '@nestjs/common';

export interface FreightQuoteParams {
    recipient: {
        postalCode: string; // Validated by DTO
        countryCode: string; // Validated by DTO
        document?: string; // Validated by DTO
        street?: string;
        number?: string;
        city?: string;
        state?: string;
    };
    items: Array<{
        weight: number;
        length: number;
        width: number;
        height: number;
        price: number;
    }>;
}

export interface FreightQuoteResult {
    serviceName: string;
    serviceCode: string; // e.g., 'STANDARD_OVERNIGHT'
    totalPrice: number;
    currency: string;
    deliveryDate?: string; // Estimated
    provider: string; // 'FEDEX', 'CORREIOS', etc.
    company?: {
        name: string;
        logo: string;
    };
}

export interface FreightProvider {
    name: string;
    getQuote(params: FreightQuoteParams): Promise<FreightQuoteResult[]>;
}
