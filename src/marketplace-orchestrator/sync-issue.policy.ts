export interface SyncIssuePolicy {
    issueKey: string;
    blocked: boolean;
    retryable: boolean;
    requiredResolutionSignals: string[];
    userMessage: string;
}

const POLICIES: Record<string, SyncIssuePolicy> = {
    AUTH_MISSING: {
        issueKey: 'marketplace_auth_missing',
        blocked: true,
        retryable: false,
        requiredResolutionSignals: ['marketplace_reconnect', 'user_publish'],
        userMessage: 'Reconecte a conta do marketplace e tente publicar novamente.',
    },
    PERMISSION_DENIED: {
        issueKey: 'marketplace_permission_denied',
        blocked: true,
        retryable: false,
        requiredResolutionSignals: ['marketplace_permission_review', 'user_publish'],
        userMessage: 'Revise as permissões da integração no marketplace e tente publicar novamente.',
    },
    CATALOG_VALIDATION_REQUIRED: {
        issueKey: 'catalog_validation_required',
        blocked: true,
        retryable: false,
        requiredResolutionSignals: ['catalog_change', 'category_change', 'user_publish'],
        userMessage: 'Corrija os dados obrigatórios de catálogo/categoria e publique novamente.',
    },
    PRODUCT_VALIDATION_FAILED: {
        issueKey: 'product_validation_failed',
        blocked: true,
        retryable: false,
        requiredResolutionSignals: ['product_data_change', 'user_publish'],
        userMessage: 'Corrija os dados obrigatórios do produto e publique novamente.',
    },
    UNKNOWN_NON_RETRYABLE: {
        issueKey: 'marketplace_sync_failed',
        blocked: true,
        retryable: false,
        requiredResolutionSignals: ['state_recheck', 'user_publish'],
        userMessage: 'Revise o erro retornado pelo marketplace e tente publicar novamente.',
    },
};

const RETRYABLE = new Set(['TIMEOUT', 'TEMPORARY_LOCK', 'NETWORK_ERROR', 'RATE_LIMIT', 'HTTP_5XX', 'SERVICE_UNAVAILABLE']);

export function buildSyncIssuePolicy(classifier?: string): SyncIssuePolicy {
    const key = String(classifier || 'UNKNOWN_NON_RETRYABLE').toUpperCase();
    if (POLICIES[key]) return POLICIES[key];
    if (RETRYABLE.has(key)) {
        return {
            issueKey: 'temporary_marketplace_failure',
            blocked: false,
            retryable: true,
            requiredResolutionSignals: ['state_recheck'],
            userMessage: 'Falha temporária no marketplace. O sistema tentará novamente.',
        };
    }
    return POLICIES.UNKNOWN_NON_RETRYABLE;
}
