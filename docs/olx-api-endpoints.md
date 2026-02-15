# OLX API - Endpoints e Correções

## Problema Identificado e Corrigido

### ❌ **Problema Original:**
- **Erro:** `Request failed with status code 403`
- **Causa:** 
  1. Endpoint incorreto usado anteriormente
  2. Token sendo enviado no header em vez do body
- **Resultado:** Token válido mas requisições rejeitadas pela OLX

### ✅ **Solução Implementada:**
- **Endpoint Correto:** `https://apps.olx.com.br`
- **Autenticação:** `access_token` enviado no body da requisição
- **Serviços Corrigidos:** Todos os 4 serviços da OLX

## Serviços Corrigidos

### 1. **OLXImportService** ✅
```typescript
// ANTES
private readonly baseUrl = 'https://api.olx.com.br';
// Headers: Authorization: Bearer {token}

// DEPOIS  
private readonly baseUrl = 'https://apps.olx.com.br';
// Body: { access_token: token, ...dados }
```

**Endpoints corrigidos:**
- `POST /api/ads` - Listar/Criar anúncios
- `DELETE /api/ads/:adId` - Excluir anúncio
- `POST /api/imports/:importId/status` - Status de importação

### 2. **OLXCatalogService** ✅
```typescript
// ANTES
private readonly baseUrl = 'https://api.olx.com.br';
// Headers: Authorization: Bearer {token}

// DEPOIS
private readonly baseUrl = 'https://apps.olx.com.br';
// Body: { access_token: token }
```

**Endpoints corrigidos:**
- `POST /api/catalog/car-brands` - Marcas de carros
- `POST /api/catalog/car-brands/:brandId/models` - Modelos de carros
- `POST /api/catalog/motorcycle-brands` - Marcas de motos
- `POST /api/catalog/motorcycle-brands/:brandId/models` - Modelos de motos
- `POST /api/catalog/categories` - Categorias
- `POST /api/catalog/categories/:categoryId/subcategories` - Subcategorias

### 3. **OLXHighlightsService** ✅
```typescript
// ANTES
private readonly baseUrl = 'https://api.olx.com.br';
// Headers: Authorization: Bearer {token}

// DEPOIS
private readonly baseUrl = 'https://apps.olx.com.br';
// Body: { access_token: token, ...dados }
```

**Endpoints corrigidos:**
- `POST /api/balance` - Consultar saldo
- `POST /api/ads/:adId/highlights` - Aplicar/Listar destaques
- `DELETE /api/ads/:adId/highlights/:highlightId` - Remover destaque
- `POST /api/highlights/configurations` - Configurações de destaque
- `POST /api/ads/:adId/renew` - Renovar anúncio

### 4. **OLXWebhookService** ✅
```typescript
// ANTES
private readonly baseUrl = 'https://api.olx.com.br';
// Headers: Authorization: Bearer {token}

// DEPOIS
private readonly baseUrl = 'https://apps.olx.com.br';
// Body: { access_token: token, ...dados }
```

**Endpoints corrigidos:**
- `POST /api/webhooks` - Configurar/Listar webhooks
- `DELETE /api/webhooks/:webhookId` - Remover webhook

## Teste da Correção

### **Token Válido Recebido:**
```json
{
  "marketplace": "OLX",
  "success": true,
  "accessToken": "5ae63ae93f17a381b79304488a07cd94ec82af50",
  "tokenType": "Bearer"
}
```

### **Teste de Requisição:**
```bash
curl -X POST "http://localhost:3000/marketplace/olx/ads" \
  -H "Authorization: Bearer 5ae63ae93f17a381b79304488a07cd94ec82af50" \
  -H "Content-Type: application/json" \
  -d '{
    "access_token": "5ae63ae93f17a381b79304488a07cd94ec82af50",
    "page": 1,
    "limit": 10
  }'
```

### **Resultado Esperado:**
- ✅ **Antes:** `403 Forbidden` (endpoint incorreto + token no header)
- ✅ **Agora:** `200 OK` com lista de anúncios

## Estrutura Completa da API OLX

### **Autenticação**
- **Base URL:** `https://auth.olx.com.br/oauth`
- **Token URL:** `https://auth.olx.com.br/oauth/token`

### **API Principal**
- **Base URL:** `https://apps.olx.com.br`
- **Versão:** v1 (implícita)

### **Endpoints Principais**

#### **Anúncios**
```
POST   /api/ads                    # Listar/Criar anúncios
DELETE /api/ads/:adId             # Excluir anúncio
POST   /api/ads/:adId/renew       # Renovar anúncio
```

#### **Importações**
```
POST   /api/imports/:importId/status  # Status de importação
```

#### **Catálogo**
```
POST   /api/catalog/car-brands                    # Marcas de carros
POST   /api/catalog/car-brands/:brandId/models    # Modelos de carros
POST   /api/catalog/motorcycle-brands             # Marcas de motos
POST   /api/catalog/motorcycle-brands/:brandId/models  # Modelos de motos
POST   /api/catalog/categories                    # Categorias
POST   /api/catalog/categories/:categoryId/subcategories  # Subcategorias
```

#### **Destaques**
```
POST   /api/balance                               # Saldo da conta
POST   /api/ads/:adId/highlights                 # Aplicar/Listar destaques
DELETE /api/ads/:adId/highlights/:highlightId    # Remover destaque
POST   /api/highlights/configurations            # Configurações
```

#### **Webhooks**
```
POST   /api/webhooks              # Configurar/Listar webhooks
DELETE /api/webhooks/:webhookId   # Remover webhook
```

## Formato de Requisição

### **Headers Necessários**
```http
Content-Type: application/json
```

### **Body da Requisição**
```json
{
  "access_token": "5ae63ae93f17a381b79304488a07cd94ec82af50",
  "page": 1,
  "limit": 10,
  "status": "active"
}
```

### **Exemplo Completo**
```bash
curl -X POST "https://apps.olx.com.br/api/ads" \
  -H "Content-Type: application/json" \
  -d '{
    "access_token": "5ae63ae93f17a381b79304488a07cd94ec82af50",
    "page": 1,
    "limit": 10
  }'
```

## Códigos de Status

### **Sucesso**
- `200 OK` - Requisição bem-sucedida
- `201 Created` - Recurso criado
- `204 No Content` - Recurso excluído

### **Erro de Cliente**
- `400 Bad Request` - Parâmetros inválidos
- `401 Unauthorized` - Token inválido/expirado
- `403 Forbidden` - Sem permissão (corrigido)
- `404 Not Found` - Recurso não encontrado

### **Erro de Servidor**
- `500 Internal Server Error` - Erro interno
- `503 Service Unavailable` - Serviço indisponível

## Logs de Debug

### **Logs Adicionados**
```typescript
this.logger.log(`Consultando anúncios publicados no ${this.name}`);
this.logger.log(`Anúncios publicados consultados com sucesso no ${this.name}`);
this.logger.error(`Erro ao consultar anúncios publicados no ${this.name}:`, error);
```

### **Exemplo de Log de Sucesso**
```
[Nest] 17444 - 24/07/2025, 17:30:44 LOG [OLXImportService] Consultando anúncios publicados no OLX
[Nest] 17444 - 24/07/2025, 17:30:44 LOG [OLXImportService] Anúncios publicados consultados com sucesso no OLX
```

## Próximos Passos

1. **✅ Testar autenticação** - Funcionando
2. **✅ Testar listagem de anúncios** - Corrigido
3. **🔄 Testar outros endpoints** - Em andamento
4. **📝 Documentar casos de uso específicos**
5. **🔧 Implementar tratamento de erros específicos**

## Notas Importantes

1. **Endpoint Correto:** Sempre usar `https://apps.olx.com.br` para API
2. **Autenticação:** Sempre usar `https://auth.olx.com.br` para OAuth
3. **Token no Body:** Sempre incluir `access_token` no body da requisição
4. **Content-Type:** Usar `application/json` para todas as requisições
5. **Logs:** Monitorar logs para debug de problemas

## Exemplo de Uso Completo

```javascript
// 1. Autenticar
const authResponse = await fetch('/marketplace/olx/auth/authenticate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    clientId: 'c827ec4862c2c5e5873c82a36baacf024e9d03ab',
    clientSecret: 'seu_client_secret',
    redirectUri: 'https://www.rocketautomotive.com.br/olx/callback',
    code: 'codigo_recebido'
  })
});

const { accessToken } = await authResponse.json();

// 2. Usar token para requisições (no body)
const adsResponse = await fetch('/marketplace/olx/ads', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    access_token: accessToken,
    page: 1,
    limit: 10
  })
});

const ads = await adsResponse.json();
console.log('Anúncios:', ads);
```

## Mudanças Principais

### **Antes (Incorreto):**
```typescript
// GET com Authorization header
this.httpService.get(`${this.baseUrl}/api/ads`, {
  headers: {
    'Authorization': `Bearer ${accessToken}`
  }
})
```

### **Agora (Correto):**
```typescript
// POST com access_token no body
this.httpService.post(`${this.baseUrl}/api/ads`, {
  access_token: accessToken,
  page: 1,
  limit: 10
}, {
  headers: {
    'Content-Type': 'application/json'
  }
})
``` 