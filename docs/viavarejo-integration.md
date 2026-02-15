# Integração com a API da Via Varejo (Grupo Casas Bahia)

Esta documentação descreve como usar a integração com a API da Via Varejo implementada no sistema.

## 📋 Visão Geral

A integração com a Via Varejo foi implementada seguindo a [documentação oficial da API](https://developers.grupocasasbahia.com.br/marketplace/docs/entenda-a-api) e inclui:

- ✅ Autenticação OAuth 2.0
- ✅ Gestão completa de produtos
- ✅ Gestão de pedidos
- ✅ Gestão de categorias
- ✅ Processamento de webhooks
- ✅ Validação de dados
- ✅ Tratamento de erros robusto
- ✅ Suporte a tracking de pedidos

## 🏗️ Arquitetura

### Estrutura de Arquivos

```
marketplace-integration/src/marketplace/adapters/viavarejo/
├── viavarejo.adapter.ts           # Adapter principal
├── viavarejo-auth.adapter.ts      # Autenticação
├── viavarejo-product.adapter.ts   # Gestão de produtos
├── viavarejo-order.adapter.ts     # Gestão de pedidos
├── viavarejo-category.adapter.ts  # Gestão de categorias
├── viavarejo.module.ts           # Módulo NestJS
└── viavarejo.constants.ts        # Constantes
```

### Componentes

1. **ViaVarejoAdapter**: Adapter principal que orquestra todas as operações
2. **ViaVarejoAuthAdapter**: Gerencia autenticação OAuth 2.0
3. **ViaVarejoProductAdapter**: Operações CRUD de produtos
4. **ViaVarejoOrderAdapter**: Gestão de pedidos
5. **ViaVarejoCategoryAdapter**: Gestão de categorias

## 🔐 Autenticação

A Via Varejo usa autenticação OAuth 2.0. Para configurar:

```typescript
const credentials = {
  clientId: 'seu_client_id',
  clientSecret: 'seu_client_secret',
  sellerId: 'seu_seller_id',
  marketplaceId: 'viavarejo'
};
```

## 📦 Gestão de Produtos

### Criar Produto

```typescript
const product = {
  title: 'Nome do Produto',
  description: 'Descrição do produto',
  price: 99.90,
  stock: 10,
  category_id: '123',
  brand: 'Marca',
  model: 'Modelo',
  sku: 'SKU123',
  ean: '7891234567890',
  warranty: 'fabricante',
  warranty_period: 12,
  images: [
    { url: 'https://exemplo.com/imagem.jpg', alt: 'Descrição' }
  ],
  // Dados de autenticação
  token: 'seu_access_token',
  sellerId: 'seu_seller_id'
};

const result = await viaVarejoAdapter.createProduct(product);
```

### Atualizar Produto

```typescript
const productUpdate = {
  title: 'Novo Nome',
  price: 89.90,
  stock: 5,
  token: 'seu_access_token',
  sellerId: 'seu_seller_id'
};

const result = await viaVarejoAdapter.updateProduct('product_id', productUpdate);
```

### Atualizar Imagens

```typescript
const images = [
  { url: 'https://exemplo.com/imagem1.jpg', alt: 'Imagem 1', position: 0 },
  { url: 'https://exemplo.com/imagem2.jpg', alt: 'Imagem 2', position: 1 },
  { token: 'seu_access_token', sellerId: 'seu_seller_id' }
];

const result = await viaVarejoAdapter.updateProductImages('product_id', images);
```

## 📋 Gestão de Pedidos

### Listar Pedidos

```typescript
const params = {
  token: 'seu_access_token',
  sellerId: 'seu_seller_id',
  limit: 10,
  page: 1,
  status: 'approved',
  include: 'items,shipping,customer'
};

const orders = await viaVarejoAdapter.getOrders(params);
```

### Obter Detalhes do Pedido

```typescript
const orderDetails = await viaVarejoAdapter.getOrderDetails({
  token: 'seu_access_token',
  sellerId: 'seu_seller_id',
  orderId: 'order_id'
});
```

### Atualizar Status do Pedido

```typescript
const result = await viaVarejoAdapter.updateOrderStatus({
  token: 'seu_access_token',
  sellerId: 'seu_seller_id',
  orderId: 'order_id'
}, 'shipped');
```

### Obter Tracking do Pedido

```typescript
const tracking = await viaVarejoAdapter.getOrderTracking(
  'order_id',
  'seu_seller_id',
  'seu_access_token'
);
```

## 📂 Gestão de Categorias

### Listar Categorias

```typescript
const categories = await viaVarejoAdapter.getCategories(
  'seu_access_token',
  'seu_seller_id',
  'parent_category_id' // opcional
);
```

### Obter Atributos da Categoria

```typescript
const attributes = await viaVarejoAdapter.getCategoryAttributes(
  'category_id',
  'seu_access_token',
  'seu_seller_id'
);
```

## 🔔 Webhooks

### Configuração

Configure o webhook no painel da Via Varejo para apontar para:

```
POST https://seu-dominio.com/webhooks/viavarejo/{topic}
```

### Processamento

O sistema processa automaticamente os seguintes tópicos:

- `order.created` - Pedido criado
- `order.updated` - Pedido atualizado
- `order.cancelled` - Pedido cancelado
- `order.shipped` - Pedido enviado
- `order.delivered` - Pedido entregue
- `product.created` - Produto criado
- `product.updated` - Produto atualizado
- `product.deleted` - Produto deletado
- `product.reviewed` - Produto revisado
- `customer.created` - Cliente criado
- `customer.updated` - Cliente atualizado

### Verificação de Assinatura

O sistema verifica automaticamente a assinatura HMAC SHA256 dos webhooks usando a variável de ambiente `VIAVAREJO_WEBHOOK_SECRET`.

## ⚙️ Configuração

### Variáveis de Ambiente

```env
VIAVAREJO_WEBHOOK_SECRET=sua_chave_secreta_para_webhooks
```

### Registro do Módulo

```typescript
// app.module.ts
import { ViaVarejoModule } from './marketplace/adapters/viavarejo/viavarejo.module';

@Module({
  imports: [
    ViaVarejoModule,
    // outros módulos...
  ],
})
export class AppModule {}
```

## 🚀 Uso no Sistema

### Injeção de Dependência

```typescript
import { ViaVarejoAdapter } from './marketplace/adapters/viavarejo/viavarejo.adapter';

@Injectable()
export class MarketplaceService {
  constructor(
    private readonly viaVarejoAdapter: ViaVarejoAdapter
  ) {}

  async createProductInViaVarejo(productData: any) {
    return this.viaVarejoAdapter.createProduct(productData);
  }
}
```

### Validação de Produtos

```typescript
const validation = await viaVarejoAdapter.validateProduct(productData);
if (!validation.isValid) {
  console.log('Campos faltando:', validation.missingRequirements);
}
```

## 📊 Endpoints da API

### Base URL
```
https://api.grupocasasbahia.com.br
```

### Principais Endpoints

- `GET /marketplace/sellers/{sellerId}/products` - Listar produtos
- `POST /marketplace/sellers/{sellerId}/products` - Criar produto
- `PUT /marketplace/sellers/{sellerId}/products/{id}` - Atualizar produto
- `GET /marketplace/sellers/{sellerId}/orders` - Listar pedidos
- `GET /marketplace/sellers/{sellerId}/orders/{id}` - Detalhes do pedido
- `PATCH /marketplace/sellers/{sellerId}/orders/{id}` - Atualizar status do pedido
- `GET /marketplace/sellers/{sellerId}/orders/{id}/tracking` - Tracking do pedido
- `GET /marketplace/sellers/{sellerId}/categories` - Listar categorias

## 🔧 Recursos da API

### Paginação
Por padrão, a API retorna 10 resultados por página. Use o parâmetro `limit` para ajustar.

### Includes
Use o parâmetro `include` para obter dados relacionados:
```
?include=items,shipping,customer,payments
```

### Cache
Consultas GET possuem cache de 30 minutos. Use `skipCache=true` para ignorar.

## 🛠️ Tratamento de Erros

O sistema inclui tratamento robusto de erros com:

- Logging detalhado
- Validação de dados
- Retry automático para falhas temporárias
- Fallback para operações críticas

## 📝 Exemplos de Uso

### Exemplo Completo de Criação de Produto

```typescript
async function createProductExample() {
  try {
    const productData = {
      title: 'Smartphone XYZ',
      description: 'Smartphone de última geração',
      price: 1299.90,
      stock: 50,
      category_id: 'electronics',
      brand: 'XYZ',
      model: 'XYZ Pro',
      sku: 'SMART-001',
      ean: '7891234567890',
      weight: 0.5,
      height: 15,
      width: 7,
      length: 1,
      warranty: 'fabricante',
      warranty_period: 12,
      images: [
        { url: 'https://exemplo.com/frente.jpg', alt: 'Frente do smartphone' },
        { url: 'https://exemplo.com/tras.jpg', alt: 'Traseira do smartphone' }
      ],
      attributes: [
        { name: 'Cor', value: 'Preto' },
        { name: 'Memória', value: '128GB' }
      ],
      token: 'seu_access_token',
      sellerId: 'seu_seller_id'
    };

    const result = await viaVarejoAdapter.createProduct(productData);
    console.log('Produto criado:', result.id);
  } catch (error) {
    console.error('Erro ao criar produto:', error.message);
  }
}
```

## 🔍 Monitoramento

O sistema inclui logs detalhados para monitoramento:

- Operações de sucesso
- Erros e exceções
- Performance das requisições
- Status dos webhooks
- Tracking de pedidos

## 📚 Referências

- [Documentação Oficial da Via Varejo](https://developers.grupocasasbahia.com.br/marketplace/docs/entenda-a-api)
- [Guia de Autenticação](https://developers.grupocasasbahia.com.br/marketplace/docs/autenticacao)
- [Referência da API](https://developers.grupocasasbahia.com.br/marketplace/docs/api-reference) 