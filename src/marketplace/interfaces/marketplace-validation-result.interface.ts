export interface ValidationError {
    field: string;
    message: string;
    code: 'REQUIRED' | 'INVALID_TYPE' | 'INVALID_VALUE' | 'PATTERN_MISMATCH' | 'MIN_LENGTH' | 'MAX_LENGTH' | 'MIN_VALUE' | 'MAX_VALUE' | 'CUSTOM' | 'REQUIRED_TITLE';
}

export interface MarketplaceValidationResult {
    isValid: boolean;
    errors: ValidationError[];
    warnings?: string[];
}
