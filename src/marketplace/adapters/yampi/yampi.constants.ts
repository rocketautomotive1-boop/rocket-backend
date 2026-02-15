export const YAMPI_CONSTANTS = {
  API_BASE_URL: 'https://api.dooki.com.br/v2',
  API_VERSION: 'v2',
  
  // Endpoints
  ENDPOINTS: {
    PRODUCTS: '/catalog/products',
    ORDERS: '/orders',
    CATEGORIES: '/catalog/categories',
    CUSTOMERS: '/customers',
    SHIPPING: '/shipping',
    PAYMENTS: '/payments',
  },
  
  // Status de pedidos
  ORDER_STATUS: {
    PENDING: 'pending',
    APPROVED: 'approved',
    SHIPPED: 'shipped',
    DELIVERED: 'delivered',
    CANCELLED: 'cancelled',
    RETURNED: 'returned',
  },
  
  // Status de produtos
  PRODUCT_STATUS: {
    ACTIVE: 'active',
    INACTIVE: 'inactive',
    DRAFT: 'draft',
  },
  
  // Webhook topics
  WEBHOOK_TOPICS: {
    ORDER_CREATED: 'order.created',
    ORDER_UPDATED: 'order.updated',
    ORDER_CANCELLED: 'order.cancelled',
    PRODUCT_CREATED: 'product.created',
    PRODUCT_UPDATED: 'product.updated',
    PRODUCT_DELETED: 'product.deleted',
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
    'name',
    'description',
    'price',
    'stock',
    'category_id'
  ],
  
  // Tipos de autenticação
  AUTH_TYPES: {
    API_KEY: 'api_key',
    OAUTH: 'oauth',
  },
  
  // Configurações de webhook
  WEBHOOK_CONFIG: {
    SIGNATURE_ALGORITHM: 'sha256',
    SIGNATURE_HEADER: 'x-yampi-hmac-sha256',
  },
}; 