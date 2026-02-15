# API Controllers - Via Varejo e Yampi

Esta documentação descreve os endpoints disponíveis para as integrações com Via Varejo e Yampi.

## Base URL
```
http://localhost:3000/marketplace/viavarejo
http://localhost:3000/marketplace/yampi
```

## Autenticação

Todos os endpoints (exceto autenticação) requerem o header `Authorization: Bearer {token}`.

## Via Varejo

### Autenticação

#### POST /marketplace/viavarejo/auth/authenticate
Autenticar na Via Varejo usando OAuth 2.0.

**Body:**
```json
{
  "clientId": "seu_client_id",
  "clientSecret": "seu_client_secret", 
  "sellerId": "seu_seller_id",
  "marketplaceId": 1
}
```

**Response:**
```json
{
  "id": null,
  "marketplace": 1,
  "accessToken": "token_de_acesso",
  "refreshToken": "token_de_refresh",
  "expiresAt": "2024-01-01T00:00:00.000Z",
  "tokenType": "Bearer",
  "additionalData": {
    "sellerId": "seu_seller_id",
    "clientId": "seu_client_id"
  },
  "isActive": true
}
```

#### POST /marketplace/viavarejo/auth/refresh
Renovar token de acesso.

#### POST /marketplace/viavarejo/auth/validate
Validar se o token ainda é válido.

### Produtos

#### POST /marketplace/viavarejo/products
Criar produto na Via Varejo.

**Headers:** `Authorization: Bearer {token}`

**Body:**
```json
{
  "title": "Nome do Produto",
  "description": "Descrição do produto",
  "price": 99.99,
  "stock": 10,
  "category_id": "123",
  "brand": "Marca",
  "model": "Modelo",
  "sku": "SKU123",
  "images": [
    {
      "url": "https://exemplo.com/imagem.jpg",
      "alt": "Descrição da imagem"
    }
  ]
}
```

#### PUT /marketplace/viavarejo/products/:externalId
Atualizar produto existente.

#### PUT /marketplace/viavarejo/products/:externalId/images
Atualizar imagens do produto.

**Body:**
```json
{
  "images": [
    {
      "url": "https://exemplo.com/nova-imagem.jpg",
      "alt": "Nova imagem"
    }
  ]
}
```

#### PUT /marketplace/viavarejo/products/:externalId/title
Atualizar título do produto.

**Body:**
```json
{
  "title": "Novo título do produto"
}
```

#### PUT /marketplace/viavarejo/products/:externalId/category
Atualizar categoria do produto.

**Body:**
```json
{
  "categoryId": "456"
}
```

#### PUT /marketplace/viavarejo/products/:externalId/inventory
Atualizar inventário do produto.

**Body:**
```json
{
  "stock": 15,
  "price": 89.99
}
```

#### POST /marketplace/viavarejo/products/validate
Validar produto antes de enviar.

### Pedidos

#### GET /marketplace/viavarejo/orders
Listar pedidos.

**Query Parameters:**
- `limit`: Limite de resultados (padrão: 10)
- `page`: Página (padrão: 1)
- `status`: Status do pedido
- `created_at_min`: Data mínima de criação
- `created_at_max`: Data máxima de criação

#### GET /marketplace/viavarejo/orders/:orderId
Obter detalhes de um pedido específico.

#### PUT /marketplace/viavarejo/orders/:orderId/status
Atualizar status do pedido.

**Body:**
```json
{
  "status": "shipped"
}
```

#### POST /marketplace/viavarejo/orders
Criar novo pedido.

#### GET /marketplace/viavarejo/orders/statuses
Obter status disponíveis para pedidos.

#### GET /marketplace/viavarejo/orders/:orderId/tracking
Obter informações de tracking do pedido.

### Categorias

#### GET /marketplace/viavarejo/categories
Listar categorias.

**Query Parameters:**
- `parentId`: ID da categoria pai (opcional)

#### GET /marketplace/viavarejo/categories/:categoryId
Obter categoria específica.

#### POST /marketplace/viavarejo/categories
Criar nova categoria.

#### PUT /marketplace/viavarejo/categories/:categoryId
Atualizar categoria.

#### DELETE /marketplace/viavarejo/categories/:categoryId
Excluir categoria.

#### GET /marketplace/viavarejo/categories/:categoryId/attributes
Obter atributos da categoria.

### Webhooks

#### POST /marketplace/viavarejo/webhooks/configure
Configurar webhook.

**Body:**
```json
{
  "url": "https://seu-dominio.com/webhook",
  "events": ["order.created", "order.updated"]
}
```

#### GET /marketplace/viavarejo/webhooks
Listar webhooks configurados.

#### DELETE /marketplace/viavarejo/webhooks/:webhookId
Remover webhook.

### Utilitários

#### POST /marketplace/viavarejo/products/check-requirements
Verificar requisitos mínimos do produto.

#### GET /marketplace/viavarejo/health
Verificar saúde da integração.

---

## Yampi

### Autenticação

#### POST /marketplace/yampi/auth/authenticate
Autenticar na Yampi usando API Key.

**Body:**
```json
{
  "clientId": "seu_client_id",
  "clientSecret": "sua_api_key",
  "merchantAlias": "seu_merchant_alias",
  "marketplaceId": 2
}
```

**Response:**
```json
{
  "id": null,
  "marketplace": 2,
  "accessToken": "sua_api_key",
  "refreshToken": null,
  "expiresAt": null,
  "tokenType": "Bearer",
  "additionalData": {
    "merchantAlias": "seu_merchant_alias",
    "clientId": "seu_client_id"
  },
  "isActive": true
}
```

#### POST /marketplace/yampi/auth/refresh
Renovar token (não aplicável para API Key).

#### POST /marketplace/yampi/auth/validate
Validar se o token ainda é válido.

### Produtos

#### POST /marketplace/yampi/products
Criar produto na Yampi.

**Headers:** `Authorization: Bearer {api_key}`

**Body:**
```json
{
  "name": "Nome do Produto",
  "description": "Descrição do produto",
  "price": 99.99,
  "stock": 10,
  "category_id": "123",
  "brand": "Marca",
  "sku": "SKU123",
  "images": [
    {
      "url": "https://exemplo.com/imagem.jpg",
      "alt": "Descrição da imagem"
    }
  ]
}
```

#### PUT /marketplace/yampi/products/:externalId
Atualizar produto existente.

#### PUT /marketplace/yampi/products/:externalId/images
Atualizar imagens do produto.

**Body:**
```json
{
  "images": [
    {
      "url": "https://exemplo.com/nova-imagem.jpg",
      "alt": "Nova imagem"
    }
  ]
}
```

#### PUT /marketplace/yampi/products/:externalId/title
Atualizar título do produto.

**Body:**
```json
{
  "title": "Novo título do produto"
}
```

#### PUT /marketplace/yampi/products/:externalId/category
Atualizar categoria do produto.

**Body:**
```json
{
  "categoryId": "456"
}
```

#### PUT /marketplace/yampi/products/:externalId/inventory
Atualizar inventário do produto.

**Body:**
```json
{
  "stock": 15,
  "price": 89.99
}
```

#### POST /marketplace/yampi/products/validate
Validar produto antes de enviar.

### Pedidos

#### GET /marketplace/yampi/orders
Listar pedidos.

**Query Parameters:**
- `limit`: Limite de resultados (padrão: 10)
- `page`: Página (padrão: 1)
- `status`: Status do pedido
- `created_at_min`: Data mínima de criação
- `created_at_max`: Data máxima de criação

#### GET /marketplace/yampi/orders/:orderId
Obter detalhes de um pedido específico.

#### PUT /marketplace/yampi/orders/:orderId/status
Atualizar status do pedido.

**Body:**
```json
{
  "status": "shipped"
}
```

#### POST /marketplace/yampi/orders
Criar novo pedido.

#### GET /marketplace/yampi/orders/statuses
Obter status disponíveis para pedidos.

### Categorias

#### GET /marketplace/yampi/categories
Listar categorias.

**Query Parameters:**
- `parentId`: ID da categoria pai (opcional)

#### GET /marketplace/yampi/categories/:categoryId
Obter categoria específica.

#### POST /marketplace/yampi/categories
Criar nova categoria.

#### PUT /marketplace/yampi/categories/:categoryId
Atualizar categoria.

#### DELETE /marketplace/yampi/categories/:categoryId
Excluir categoria.

#### GET /marketplace/yampi/categories/:categoryId/attributes
Obter atributos da categoria.

### Webhooks

#### POST /marketplace/yampi/webhooks/configure
Configurar webhook.

**Body:**
```json
{
  "url": "https://seu-dominio.com/webhook",
  "events": ["order.created", "order.updated"]
}
```

#### GET /marketplace/yampi/webhooks
Listar webhooks configurados.

#### DELETE /marketplace/yampi/webhooks/:webhookId
Remover webhook.

### Utilitários

#### POST /marketplace/yampi/products/check-requirements
Verificar requisitos mínimos do produto.

#### GET /marketplace/yampi/health
Verificar saúde da integração.

---

## Códigos de Status

- `200`: Sucesso
- `201`: Criado com sucesso
- `400`: Requisição inválida
- `401`: Não autorizado
- `404`: Não encontrado
- `500`: Erro interno do servidor

## Exemplos de Uso

### Via Varejo - Criar Produto
```bash
curl -X POST http://localhost:3000/marketplace/viavarejo/products \
  -H "Authorization: Bearer seu_token" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Smartphone XYZ",
    "description": "Smartphone de última geração",
    "price": 1299.99,
    "stock": 5,
    "category_id": "123",
    "brand": "Marca",
    "model": "XYZ Pro"
  }'
```

### Yampi - Listar Pedidos
```bash
curl -X GET "http://localhost:3000/marketplace/yampi/orders?limit=10&page=1" \
  -H "Authorization: Bearer sua_api_key"
```

### Via Varejo - Atualizar Status do Pedido
```bash
curl -X PUT http://localhost:3000/marketplace/viavarejo/orders/123/status \
  -H "Authorization: Bearer seu_token" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "shipped"
  }'
```

## Notas Importantes

1. **Via Varejo**: Usa OAuth 2.0 com tokens que expiram
2. **Yampi**: Usa API Key que não expira
3. Todos os endpoints retornam JSON
4. Erros são retornados com detalhes no corpo da resposta
5. Webhooks são processados automaticamente pelo sistema
6. Validação de produtos é feita antes do envio
7. Logs detalhados são gerados para debugging 