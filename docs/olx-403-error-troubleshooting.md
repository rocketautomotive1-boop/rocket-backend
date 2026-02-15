# Resolução do Erro 403 da OLX (Cloudflare)

## Problema Identificado

O erro 403 (Forbidden) com resposta do Cloudflare indica que a OLX está bloqueando as requisições automatizadas. Isso é comum quando:

1. **Requisições muito frequentes** - A OLX limita o número de tentativas
2. **Headers inadequados** - Falta de User-Agent ou headers de navegador
3. **IP não autorizado** - Seu IP pode estar na lista negra
4. **Autenticação manual necessária** - Primeira autenticação deve ser manual

## Soluções Implementadas

### 1. Headers Melhorados

Adicionamos headers de navegador real para evitar detecção de bot:

```typescript
headers: {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Cache-Control': 'no-cache'
}
```

### 2. Fluxo Client Credentials Direto

Implementamos tentativa de client credentials flow direto antes do authorization code:

```typescript
// Primeiro tenta client credentials flow
const directTokenResponse = await firstValueFrom(
  this.httpService.post(`${this.baseUrl}/oauth/token`, {
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'autoupload basic_user_info'
  }, { headers: improvedHeaders })
);
```

### 3. Fallback para Authorization Code

Se client credentials falhar, tenta authorization code flow com headers melhorados.

## Passos para Resolver

### 1. Verificar Configuração

Teste suas configurações primeiro:

```bash
curl -X POST http://localhost:3000/marketplace/olx/auth/test-credentials
```

### 2. Verificar Credenciais

Teste se as credenciais estão corretas:

```bash
curl -X GET http://localhost:3000/marketplace/olx/auth/config-test
```

### 3. Aguardar e Tentar Novamente

Se receber erro 403:

1. **Aguarde 5-10 minutos** antes de tentar novamente
2. **Verifique se as credenciais estão corretas** no `.env`
3. **Teste a conectividade** com o endpoint de teste

### 4. Configuração Manual Inicial (Se Necessário)

Se o erro persistir, pode ser necessário fazer uma autenticação manual inicial:

1. Acesse: `https://auth.olx.com.br/oauth`
2. Faça login manualmente
3. Autorize sua aplicação
4. Copie o authorization code
5. Use o endpoint de autenticação manual

## Endpoints de Teste Disponíveis

### 1. Teste de Configuração
```bash
GET /marketplace/olx/auth/config-test
```

### 2. Teste de Credenciais
```bash
POST /marketplace/olx/auth/test-credentials
```

### 3. Status dos Tokens
```bash
GET /marketplace/olx/auth/status
```

### 4. Autenticação Automática
```bash
POST /marketplace/olx/auth/auto-authenticate
```

## Configuração do .env

Certifique-se de que seu `.env` está configurado corretamente:

```env
# OLX Configuration
OLX_CLIENT_ID=seu_client_id_aqui
OLX_CLIENT_SECRET_seu_client_id_aqui=seu_client_secret_aqui
OLX_REDIRECT_URI=http://localhost:3000/oauth/callback

# Database
DB_HOST=localhost
DB_PORT=3306
DB_USERNAME=root
DB_PASSWORD=sua_senha
DB_DATABASE=marketplace_integration

# Server
PORT=3000
NODE_ENV=development
```

## Troubleshooting Avançado

### 1. Verificar Logs Detalhados

Ative logs detalhados no `main.ts`:

```typescript
// Adicione no main.ts
app.useLogger(new Logger());
```

### 2. Testar Conectividade

Teste se consegue acessar a API da OLX:

```bash
curl -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" \
     -H "Accept: text/html,application/xhtml+xml,application/xml;q=0.9" \
     https://auth.olx.com.br/oauth
```

### 3. Verificar Marketplace no Banco

Certifique-se de que o marketplace OLX existe no banco:

```sql
SELECT * FROM marketplaces WHERE name = 'OLX';
```

### 4. Limpar Cache de Tokens

Se necessário, limpe tokens antigos:

```sql
UPDATE marketplace_tokens SET is_active = false WHERE marketplace_id = (SELECT id FROM marketplaces WHERE name = 'OLX');
```

## Próximos Passos

1. **Teste as configurações** com os endpoints de teste
2. **Aguarde alguns minutos** se receber erro 403
3. **Verifique os logs** para detalhes do erro
4. **Configure as credenciais corretas** se necessário
5. **Tente a autenticação automática** novamente

## Contato

Se o problema persistir após seguir todos os passos:

1. Verifique se as credenciais da OLX estão corretas
2. Teste a conectividade com a API da OLX
3. Considere fazer uma autenticação manual inicial
4. Verifique se seu IP não está bloqueado pela OLX 