export const VIAVAREJO_CONSTANTS = {
  API_BASE_URL: 'https://api.grupocasasbahia.com.br',
  API_VERSION: 'v1',
  
  // Endpoints
  ENDPOINTS: {
    PRODUCTS: '/marketplace/sellers/{sellerId}/products',
    ORDERS: '/marketplace/sellers/{sellerId}/orders',
    CATEGORIES: '/marketplace/sellers/{sellerId}/categories',
    CUSTOMERS: '/marketplace/sellers/{sellerId}/customers',
    SHIPPING: '/marketplace/sellers/{sellerId}/shipping',
    PAYMENTS: '/marketplace/sellers/{sellerId}/payments',
    TRACKING: '/marketplace/sellers/{sellerId}/orders/{orderId}/tracking',
  },
  
  // Status de pedidos
  ORDER_STATUS: {
    PENDING: 'pending',
    APPROVED: 'approved',
    PROCESSING: 'processing',
    SHIPPED: 'shipped',
    DELIVERED: 'delivered',
    CANCELLED: 'cancelled',
    RETURNED: 'returned',
    REFUNDED: 'refunded',
  },
  
  // Status de produtos
  PRODUCT_STATUS: {
    ACTIVE: 'active',
    INACTIVE: 'inactive',
    DRAFT: 'draft',
    PENDING_REVIEW: 'pending_review',
    REJECTED: 'rejected',
  },
  
  // Webhook topics
  WEBHOOK_TOPICS: {
    ORDER_CREATED: 'order.created',
    ORDER_UPDATED: 'order.updated',
    ORDER_CANCELLED: 'order.cancelled',
    ORDER_SHIPPED: 'order.shipped',
    ORDER_DELIVERED: 'order.delivered',
    PRODUCT_CREATED: 'product.created',
    PRODUCT_UPDATED: 'product.updated',
    PRODUCT_DELETED: 'product.deleted',
    PRODUCT_REVIEWED: 'product.reviewed',
    CUSTOMER_CREATED: 'customer.created',
    CUSTOMER_UPDATED: 'customer.updated',
  },
  
  // Headers
  HEADERS: {
    CONTENT_TYPE: 'application/json',
    AUTHORIZATION: 'Authorization',
  },
  
  // Paginação padrão
  PAGINATION: {
    DEFAULT_LIMIT: 10,
    MAX_LIMIT: 100,
  },
  
  // Cache
  CACHE: {
    DEFAULT_TTL: 1800, // 30 minutos em segundos
  },
  
  // Campos obrigatórios para produtos
  REQUIRED_PRODUCT_FIELDS: [
    'title',
    'description',
    'price',
    'stock',
    'category_id',
    'brand',
    'model'
  ],
  
  // Tipos de autenticação
  AUTH_TYPES: {
    OAUTH2: 'oauth2',
    CLIENT_CREDENTIALS: 'client_credentials',
  },
  
  // Configurações de webhook
  WEBHOOK_CONFIG: {
    SIGNATURE_ALGORITHM: 'sha256',
    SIGNATURE_HEADER: 'x-viavarejo-signature',
  },
  
  // Tipos de garantia
  WARRANTY_TYPES: {
    FABRICANTE: 'fabricante',
    LOJA: 'loja',
    NENHUMA: 'nenhuma',
  },
  
  // Períodos de garantia (em meses)
  WARRANTY_PERIODS: {
    TRES_MESES: 3,
    SEIS_MESES: 6,
    DOZE_MESES: 12,
    VINTE_QUATRO_MESES: 24,
  },
  
  // Status de tracking
  TRACKING_STATUS: {
    PENDING: 'pending',
    IN_TRANSIT: 'in_transit',
    OUT_FOR_DELIVERY: 'out_for_delivery',
    DELIVERED: 'delivered',
    FAILED_DELIVERY: 'failed_delivery',
    RETURNED: 'returned',
  },
}; 