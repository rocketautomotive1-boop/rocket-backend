# Autenticação OLX - Guia Completo

## Visão Geral

A integração com a OLX utiliza OAuth 2.0 para autenticação. O fluxo de autenticação foi atualizado para usar o endpoint correto da OLX.

## Endpoint de Autenticação

**URL Base:** `https://auth.olx.com.br/oauth`

## Fluxo de Autenticação

### 1. Gerar URL de Autorização

**Endpoint:** `GET /marketplace/olx/auth/url`

**Parâmetros:**
- `clientId` (obrigatório): ID do cliente OLX
- `redirectUri` (obrigatório): URI de redirecionamento
- `scope` (opcional): Escopo de permissões (padrão: `autoupload basic_user_info`)

**Exemplo:**
```bash
curl -X GET "http://localhost:3000/marketplace/olx/auth/url?clientId=c827ec4862c2c5e5873c82a36baacf024e9d03ab&redirectUri=https://www.rocketautomotive.com.br/olx/callback&scope=autoupload%20basic_user_info"
```

**Resposta:**
```json
{
  "authUrl": "https://auth.olx.com.br/oauth?scope=autoupload%20basic_user_info&state=%2Fprofile&redirect_uri=https%3A%2F%2Fwww.rocketautomotive.com.br%2Folx%2Fcallback&response_type=code&client_id=c827ec4862c2c5e5873c82a36baacf024e9d03ab"
}
```

### 2. Redirecionar o Usuário

Redirecione o usuário para a URL gerada. O usuário será direcionado para a página de login da OLX.

### 3. Receber o Código de Autorização

Após o usuário autorizar, a OLX redirecionará para sua `redirectUri` com um código de autorização:

```
https://www.rocketautomotive.com.br/olx/callback?code=AUTHORIZATION_CODE&state=/profile
```

### 4. Trocar o Código por Token

**Endpoint:** `POST /marketplace/olx/auth/authenticate`

**Body:**
```json
{
  "clientId": "c827ec4862c2c5e5873c82a36baacf024e9d03ab",
  "clientSecret": "SEU_CLIENT_SECRET",
  "redirectUri": "https://www.rocketautomotive.com.br/olx/callback",
  "code": "AUTHORIZATION_CODE_RECEBIDO"
}
```

**Exemplo:**
```bash
curl -X POST "http://localhost:3000/marketplace/olx/auth/authenticate" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "c827ec4862c2c5e5873c82a36baacf024e9d03ab",
    "clientSecret": "seu_client_secret_aqui",
    "redirectUri": "https://www.rocketautomotive.com.br/olx/callback",
    "code": "codigo_recebido_da_olx"
  }'
```

**Resposta de Sucesso:**
```json
{
  "marketplace": "OLX",
  "success": true,
  "accessToken": "ACCESS_TOKEN_AQUI",
  "refreshToken": "REFRESH_TOKEN_AQUI",
  "expiresIn": 3600,
  "tokenType": "Bearer"
}
```

## Renovação de Token

### Renovar Token de Acesso

**Endpoint:** `POST /marketplace/olx/auth/refresh`

**Body:**
```json
{
  "clientId": "c827ec4862c2c5e5873c82a36baacf024e9d03ab",
  "clientSecret": "SEU_CLIENT_SECRET",
  "refreshToken": "REFRESH_TOKEN_AQUI"
}
```

**Exemplo:**
```bash
curl -X POST "http://localhost:3000/marketplace/olx/auth/refresh" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "c827ec4862c2c5e5873c82a36baacf024e9d03ab",
    "clientSecret": "seu_client_secret_aqui",
    "refreshToken": "refresh_token_aqui"
  }'
```

## Usando o Token de Acesso

Após obter o `accessToken`, você pode usar em todas as requisições que precisam de autenticação:

### Exemplo: Listar Anúncios

```bash
curl -X GET "http://localhost:3000/marketplace/olx/ads" \
  -H "Authorization: Bearer SEU_ACCESS_TOKEN" \
  -H "Content-Type: application/json"
```

### Exemplo: Importar Anúncio

```bash
curl -X POST "http://localhost:3000/marketplace/olx/ads/import" \
  -H "Authorization: Bearer SEU_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Produto Automotivo",
    "description": "Descrição do produto",
    "price": 100.00,
    "category": "automotive"
  }'
```

## Endpoints Disponíveis

### Autenticação
- `GET /marketplace/olx/auth/url` - Gerar URL de autorização
- `POST /marketplace/olx/auth/authenticate` - Autenticar com código
- `POST /marketplace/olx/auth/refresh` - Renovar token

### Anúncios
- `GET /marketplace/olx/ads` - Listar anúncios publicados
- `POST /marketplace/olx/ads/import` - Importar anúncio
- `DELETE /marketplace/olx/ads/:adId` - Excluir anúncio
- `GET /marketplace/olx/imports/:importId/status` - Status de importação

### Catálogo
- `GET /marketplace/olx/catalog/car-brands` - Marcas de carros
- `GET /marketplace/olx/catalog/car-brands/:brandId/models` - Modelos de carros
- `GET /marketplace/olx/catalog/motorcycle-brands` - Marcas de motos
- `GET /marketplace/olx/catalog/motorcycle-brands/:brandId/models` - Modelos de motos
- `GET /marketplace/olx/catalog/categories` - Categorias
- `GET /marketplace/olx/catalog/categories/:categoryId/subcategories` - Subcategorias

### Destaques e Saldos
- `GET /marketplace/olx/balance` - Consultar saldo
- `POST /marketplace/olx/ads/:adId/highlights` - Aplicar destaque
- `DELETE /marketplace/olx/ads/:adId/highlights/:highlightId` - Remover destaque
- `GET /marketplace/olx/ads/:adId/highlights` - Listar destaques
- `GET /marketplace/olx/highlights/configurations` - Configurações de destaque
- `POST /marketplace/olx/ads/:adId/renew` - Renovar anúncio

### Webhooks
- `POST /marketplace/olx/webhooks` - Configurar webhook
- `GET /marketplace/olx/webhooks` - Listar webhooks
- `DELETE /marketplace/olx/webhooks/:webhookId` - Remover webhook
- `POST /marketplace/olx/webhooks/receive` - Receber notificação

### Utilitários
- `POST /marketplace/olx/products/check-requirements` - Verificar requisitos
- `GET /marketplace/olx/health` - Verificar saúde da integração

## Configuração de Credenciais

### Credenciais Necessárias
- **Client ID:** `c827ec4862c2c5e5873c82a36baacf024e9d03ab`
- **Client Secret:** Fornecido pela OLX
- **Redirect URI:** `https://www.rocketautomotive.com.br/olx/callback`

### Escopo de Permissões
- `autoupload` - Permite upload automático de anúncios
- `basic_user_info` - Permite acesso a informações básicas do usuário

## Tratamento de Erros

### Erro de Autenticação
```json
{
  "statusCode": 400,
  "message": "Falha na autenticação com OLX: Invalid credentials",
  "error": "Bad Request"
}
```

### Erro de Token
```json
{
  "statusCode": 400,
  "message": "Authorization header is required",
  "error": "Bad Request"
}
```

## Exemplo Completo de Implementação

### 1. Frontend - Gerar URL de Autorização
```javascript
const generateAuthUrl = async () => {
  const response = await fetch('/marketplace/olx/auth/url?clientId=c827ec4862c2c5e5873c82a36baacf024e9d03ab&redirectUri=https://www.rocketautomotive.com.br/olx/callback');
  const data = await response.json();
  window.location.href = data.authUrl;
};
```

### 2. Callback Handler
```javascript
const handleCallback = async (code) => {
  const response = await fetch('/marketplace/olx/auth/authenticate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      clientId: 'c827ec4862c2c5e5873c82a36baacf024e9d03ab',
      clientSecret: 'seu_client_secret',
      redirectUri: 'https://www.rocketautomotive.com.br/olx/callback',
      code: code
    })
  });
  
  const tokenData = await response.json();
  // Salvar token no localStorage ou estado da aplicação
  localStorage.setItem('olx_access_token', tokenData.accessToken);
};
```

### 3. Usar Token para Requisições
```javascript
const listAds = async () => {
  const token = localStorage.getItem('olx_access_token');
  const response = await fetch('/marketplace/olx/ads', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  const ads = await response.json();
  return ads;
};
```

## Notas Importantes

1. **Segurança:** Nunca exponha o `clientSecret` no frontend
2. **Tokens:** Armazene os tokens de forma segura
3. **Renovação:** Implemente renovação automática de tokens
4. **Escopo:** Use apenas os escopos necessários para sua aplicação
5. **Rate Limiting:** Respeite os limites de requisição da OLX 