# Integração com a API da Yampi

Esta documentação descreve como usar a integração com a API da Yampi implementada no sistema.

## 📋 Visão Geral

A integração com a Yampi foi implementada seguindo a [documentação oficial da API](https://docs.yampi.com.br/api-reference/introduction) e inclui:

- ✅ Autenticação via API Key
- ✅ Gestão completa de produtos
- ✅ Gestão de pedidos
- ✅ Gestão de categorias
- ✅ Processamento de webhooks
- ✅ Validação de dados
- ✅ Tratamento de erros robusto

## 🏗️ Arquitetura

### Estrutura de Arquivos

```
marketplace-integration/src/marketplace/adapters/yampi/
├── yampi.adapter.ts           # Adapter principal
├── yampi-auth.adapter.ts      # Autenticação
├── yampi-product.adapter.ts   # Gestão de produtos
├── yampi-order.adapter.ts     # Gestão de pedidos
├── yampi-category.adapter.ts  # Gestão de categorias
├── yampi.module.ts           # Módulo NestJS
└── yampi.constants.ts        # Constantes
```

### Componentes

1. **YampiAdapter**: Adapter principal que orquestra todas as operações
2. **YampiAuthAdapter**: Gerencia autenticação via API Key
3. **YampiProductAdapter**: Operações CRUD de produtos
4. **YampiOrderAdapter**: Gestão de pedidos
5. **YampiCategoryAdapter**: Gestão de categorias

## 🔐 Autenticação

A Yampi usa autenticação via API Key. Para configurar:

```typescript
const credentials = {
  clientId: 'seu_client_id',
  clientSecret: 'sua_api_key', // API Key da Yampi
  merchantAlias: 'seu_merchant_alias',
  marketplaceId: 'yampi'
};
```

## 📦 Gestão de Produtos

### Criar Produto

```typescript
const product = {
  name: 'Nome do Produto',
  description: 'Descrição do produto',
  price: 99.90,
  stock: 10,
  category_id: '123',
  brand: 'Marca',
  sku: 'SKU123',
  images: [
    { url: 'https://exemplo.com/imagem.jpg', alt: 'Descrição' }
  ],
  // Dados de autenticação
  token: 'sua_api_key',
  merchantAlias: 'seu_merchant_alias'
};

const result = await yampiAdapter.createProduct(product);
```

### Atualizar Produto

```typescript
const productUpdate = {
  name: 'Novo Nome',
  price: 89.90,
  stock: 5,
  token: 'sua_api_key',
  merchantAlias: 'seu_merchant_alias'
};

const result = await yampiAdapter.updateProduct('product_id', productUpdate);
```

### Atualizar Imagens

```typescript
const images = [
  { url: 'https://exemplo.com/imagem1.jpg', alt: 'Imagem 1', position: 0 },
  { url: 'https://exemplo.com/imagem2.jpg', alt: 'Imagem 2', position: 1 },
  { token: 'sua_api_key', merchantAlias: 'seu_merchant_alias' }
];

const result = await yampiAdapter.updateProductImages('product_id', images);
```

## 📋 Gestão de Pedidos

### Listar Pedidos

```typescript
const params = {
  token: 'sua_api_key',
  merchantAlias: 'seu_merchant_alias',
  limit: 10,
  page: 1,
  status: 'approved',
  include: 'items,shipping,customer'
};

const orders = await yampiAdapter.getOrders(params);
```

### Obter Detalhes do Pedido

```typescript
const orderDetails = await yampiAdapter.getOrderDetails({
  token: 'sua_api_key',
  merchantAlias: 'seu_merchant_alias',
  orderId: 'order_id'
});
```

### Atualizar Status do Pedido

```typescript
const result = await yampiAdapter.updateOrderStatus({
  token: 'sua_api_key',
  merchantAlias: 'seu_merchant_alias',
  orderId: 'order_id'
}, 'shipped');
```

## 📂 Gestão de Categorias

### Listar Categorias

```typescript
const categories = await yampiAdapter.getCategories(
  'sua_api_key',
  'seu_merchant_alias',
  'parent_category_id' // opcional
);
```

## 🔔 Webhooks

### Configuração

Configure o webhook no painel da Yampi para apontar para:

```
POST https://seu-dominio.com/webhooks/yampi/{topic}
```

### Processamento

O sistema processa automaticamente os seguintes tópicos:

- `order.created` - Pedido criado
- `order.updated` - Pedido atualizado
- `order.cancelled` - Pedido cancelado
- `product.created` - Produto criado
- `product.updated` - Produto atualizado
- `product.deleted` - Produto deletado
- `customer.created` - Cliente criado
- `customer.updated` - Cliente atualizado

### Verificação de Assinatura

O sistema verifica automaticamente a assinatura HMAC SHA256 dos webhooks usando a variável de ambiente `YAMPI_WEBHOOK_SECRET`.

## ⚙️ Configuração

### Variáveis de Ambiente

```env
YAMPI_WEBHOOK_SECRET=sua_chave_secreta_para_webhooks
```

### Registro do Módulo

```typescript
// app.module.ts
import { YampiModule } from './marketplace/adapters/yampi/yampi.module';

@Module({
  imports: [
    YampiModule,
    // outros módulos...
  ],
})
export class AppModule {}
```

## 🚀 Uso no Sistema

### Injeção de Dependência

```typescript
import { YampiAdapter } from './marketplace/adapters/yampi/yampi.adapter';

@Injectable()
export class MarketplaceService {
  constructor(
    private readonly yampiAdapter: YampiAdapter
  ) {}

  async createProductInYampi(productData: any) {
    return this.yampiAdapter.createProduct(productData);
  }
}
```

### Validação de Produtos

```typescript
const validation = await yampiAdapter.validateProduct(productData);
if (!validation.isValid) {
  console.log('Campos faltando:', validation.missingRequirements);
}
```

## 📊 Endpoints da API

### Base URL
```
https://api.dooki.com.br/v2/{merchantAlias}
```

### Principais Endpoints

- `GET /catalog/products` - Listar produtos
- `POST /catalog/products` - Criar produto
- `PUT /catalog/products/{id}` - Atualizar produto
- `GET /orders` - Listar pedidos
- `GET /orders/{id}` - Detalhes do pedido
- `PATCH /orders/{id}` - Atualizar status do pedido
- `GET /catalog/categories` - Listar categorias

## 🔧 Recursos da API

### Paginação
Por padrão, a API retorna 10 resultados por página. Use o parâmetro `limit` para ajustar.

### Includes
Use o parâmetro `include` para obter dados relacionados:
```
?include=skus,images,category
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
      name: 'Smartphone XYZ',
      description: 'Smartphone de última geração',
      price: 1299.90,
      stock: 50,
      category_id: 'electronics',
      brand: 'XYZ',
      sku: 'SMART-001',
      weight: 0.5,
      height: 15,
      width: 7,
      length: 1,
      images: [
        { url: 'https://exemplo.com/frente.jpg', alt: 'Frente do smartphone' },
        { url: 'https://exemplo.com/tras.jpg', alt: 'Traseira do smartphone' }
      ],
      attributes: [
        { name: 'Cor', value: 'Preto' },
        { name: 'Memória', value: '128GB' }
      ],
      token: 'sua_api_key',
      merchantAlias: 'seu_merchant_alias'
    };

    const result = await yampiAdapter.createProduct(productData);
    console.log('Produto criado:', result.data.id);
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

## 📚 Referências

- [Documentação Oficial da Yampi](https://docs.yampi.com.br/api-reference/introduction)
- [Guia de Autenticação](https://docs.yampi.com.br/api-reference/authentication)
- [Referência da API](https://docs.yampi.com.br/api-reference) 