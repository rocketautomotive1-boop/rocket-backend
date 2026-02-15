# Integração com OLX API

Esta integração implementa todas as funcionalidades disponíveis na [API de Integração de Anúncios da OLX](https://developers.olx.com.br/anuncio/api/home.html).

## Funcionalidades Implementadas

### ✅ Autenticação OAuth
- Autenticação com código de autorização
- Renovação de tokens
- Geração de URLs de autorização

### ✅ Importação de Anúncios
- Inserção/Edição de anúncios
- Deleção de anúncios
- Consulta de status de importação
- Listagem de anúncios publicados

### ✅ Catálogo de Veículos
- Consulta de marcas de carros
- Consulta de modelos de carros
- Consulta de marcas de motos
- Consulta de modelos de motos
- Consulta de categorias e subcategorias

### ✅ Destaques e Saldos
- Consulta de saldo e limites
- Aplicação de destaques
- Remoção de destaques
- Consulta de destaques de anúncios
- Configurações de destaques
- Renovação de anúncios

### ✅ Webhooks
- Configuração de webhooks
- Listagem de webhooks
- Remoção de webhooks
- Processamento de notificações

## Endpoints Disponíveis

### Autenticação
```
POST /marketplace/olx/auth/authenticate
POST /marketplace/olx/auth/refresh
GET /marketplace/olx/auth/url
```

### Importação de Anúncios
```
POST /marketplace/olx/ads/import
DELETE /marketplace/olx/ads/:adId
GET /marketplace/olx/imports/:importId/status
GET /marketplace/olx/ads
```

### Catálogo
```
GET /marketplace/olx/catalog/car-brands
GET /marketplace/olx/catalog/car-brands/:brandId/models
GET /marketplace/olx/catalog/motorcycle-brands
GET /marketplace/olx/catalog/motorcycle-brands/:brandId/models
GET /marketplace/olx/catalog/categories
GET /marketplace/olx/catalog/categories/:categoryId/subcategories
```

### Destaques e Saldos
```
GET /marketplace/olx/balance
POST /marketplace/olx/ads/:adId/highlights
DELETE /marketplace/olx/ads/:adId/highlights/:highlightId
GET /marketplace/olx/ads/:adId/highlights
GET /marketplace/olx/highlights/configurations
POST /marketplace/olx/ads/:adId/renew
```

### Webhooks
```
POST /marketplace/olx/webhooks
GET /marketplace/olx/webhooks
DELETE /marketplace/olx/webhooks/:webhookId
POST /marketplace/olx/webhooks/receive
```

### Verificação de Requisitos
```
POST /marketplace/olx/products/check-requirements
```

## Exemplos de Uso

### 1. Autenticação OAuth

```javascript
// Gerar URL de autorização
const authUrl = await fetch('/marketplace/olx/auth/url?clientId=YOUR_CLIENT_ID&redirectUri=YOUR_REDIRECT_URI');

// Após receber o código de autorização
const authResponse = await fetch('/marketplace/olx/auth/authenticate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    clientId: 'YOUR_CLIENT_ID',
    clientSecret: 'YOUR_CLIENT_SECRET',
    redirectUri: 'YOUR_REDIRECT_URI',
    code: 'AUTHORIZATION_CODE'
  })
});
```

### 2. Importar Anúncio

```javascript
const product = {
  partNumber: '12345',
  name: 'Paralama Fiat Strada',
  brand: { name: 'Fiat' },
  category: { name: 'Paralamas' },
  productTitles: [{ title: 'Paralama Fiat Strada 2022' }],
  shortDescription: 'Paralama original Fiat Strada',
  inventories: [{ price: 150.00, quantity: 10 }],
  productImages: [{ url: 'https://example.com/image.jpg' }]
};

const response = await fetch('/marketplace/olx/ads/import', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_ACCESS_TOKEN',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(product)
});
```

### 3. Consultar Catálogo

```javascript
// Consultar marcas de carros
const brands = await fetch('/marketplace/olx/catalog/car-brands', {
  headers: { 'Authorization': 'Bearer YOUR_ACCESS_TOKEN' }
});

// Consultar modelos de uma marca
const models = await fetch('/marketplace/olx/catalog/car-brands/FIAT/models', {
  headers: { 'Authorization': 'Bearer YOUR_ACCESS_TOKEN' }
});
```

### 4. Aplicar Destaque

```javascript
const highlight = await fetch('/marketplace/olx/ads/12345/highlights', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_ACCESS_TOKEN',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ highlightType: 'premium' })
});
```

### 5. Configurar Webhook

```javascript
const webhook = await fetch('/marketplace/olx/webhooks', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_ACCESS_TOKEN',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    url: 'https://your-domain.com/webhooks/olx',
    events: ['ad_status_changed', 'ad_created', 'ad_updated']
  })
});
```

## Estrutura de Arquivos

```
olx/
├── olx-product.adapter.ts      # Adaptador principal
├── olx-auth.service.ts         # Serviço de autenticação
├── olx-import.service.ts       # Serviço de importação
├── olx-catalog.service.ts      # Serviço de catálogo
├── olx-highlights.service.ts   # Serviço de destaques
├── olx-webhook.service.ts      # Serviço de webhooks
├── olx.controller.ts           # Controller REST
├── olx.module.ts              # Módulo NestJS
└── README.md                  # Esta documentação
```

## Configuração

Para usar esta integração, você precisa:

1. **Registrar-se como integrador** na OLX
2. **Obter credenciais OAuth** (clientId e clientSecret)
3. **Configurar URL de redirecionamento** no painel da OLX
4. **Importar o OLXModule** no seu módulo principal

```typescript
import { OLXModule } from './marketplace/adapters/olx/olx.module';

@Module({
  imports: [OLXModule],
  // ...
})
export class AppModule {}
```

## Tratamento de Erros

Todos os serviços incluem tratamento de erros robusto com:
- Logs detalhados
- Mensagens de erro descritivas
- Retorno de status de sucesso/falha
- Informações sobre campos obrigatórios

## Webhooks

O sistema processa automaticamente os seguintes eventos:
- `ad_status_changed` - Mudança de status do anúncio
- `ad_created` - Anúncio criado
- `ad_updated` - Anúncio atualizado
- `ad_deleted` - Anúncio deletado
- `highlight_applied` - Destaque aplicado
- `highlight_removed` - Destaque removido

## Requisitos Mínimos de Produtos

Para publicar um produto na OLX, ele deve ter:
- ✅ Código do produto (partNumber)
- ✅ Marca do produto
- ✅ Título do produto
- ✅ Categoria do produto
- ✅ Preço do produto
- ✅ Quantidade do produto
- ✅ Imagens do produto

## Suporte

Para dúvidas ou sugestões sobre a integração, entre em contato com suporteintegrador@olxbr.com. 