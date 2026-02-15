# Configuração da Autenticação Automática da OLX

## 1. Variáveis de Ambiente Necessárias

Crie um arquivo `.env` na raiz do projeto com as seguintes variáveis:

```env
# ===== CONFIGURAÇÕES DA OLX =====

# Client ID da aplicação OLX (fornecido pela OLX)
OLX_CLIENT_ID=your_client_id_here

# Client Secret da aplicação OLX (fornecido pela OLX)
# IMPORTANTE: O nome da variável deve incluir o Client ID
OLX_CLIENT_SECRET_your_client_id_here=your_client_secret_here

# URI de redirecionamento configurado na aplicação OLX
OLX_REDIRECT_URI=http://localhost:3000/oauth/callback

# ===== CONFIGURAÇÕES DO BANCO DE DADOS =====
DATABASE_URL=postgresql://username:password@localhost:5432/marketplace_db

# ===== CONFIGURAÇÕES DO SERVIDOR =====
PORT=3000
NODE_ENV=development

# ===== CONFIGURAÇÕES DE LOG =====
LOG_LEVEL=debug

# ===== CONFIGURAÇÕES DE SEGURANÇA =====
JWT_SECRET=your_jwt_secret_here

# ===== CONFIGURAÇÕES DE FILAS =====
RABBITMQ_URL=amqp://localhost:5672
MARKETPLACE_QUEUE=marketplace_integration
```

## 2. Configuração no Banco de Dados

### 2.1. Configurar Marketplace OLX

Execute a seguinte query no banco de dados:

```sql
-- Verificar se o marketplace OLX existe
SELECT * FROM marketplaces WHERE name = 'OLX';

-- Se não existir, criar o marketplace OLX
INSERT INTO marketplaces (name, appId, isActive, createdAt, updatedAt) 
VALUES ('OLX', 'your_client_id_here', true, NOW(), NOW());

-- Se já existir, atualizar o appId
UPDATE marketplaces 
SET appId = 'your_client_id_here', updatedAt = NOW() 
WHERE name = 'OLX';
```

### 2.2. Verificar Tabela de Tokens

Certifique-se de que a tabela `marketplace_tokens` existe:

```sql
-- Verificar estrutura da tabela
DESCRIBE marketplace_tokens;

-- Verificar tokens existentes para OLX
SELECT * FROM marketplace_tokens 
WHERE marketplaceId = (SELECT id FROM marketplaces WHERE name = 'OLX');
```

## 3. Endpoints Disponíveis

### 3.1. Autenticação Automática

```http
POST /marketplace/olx/auth/auto-authenticate
```

**Descrição:** Realiza autenticação automática usando as credenciais configuradas.

**Resposta de Sucesso:**
```json
{
  "marketplace": "OLX",
  "success": true,
  "message": "Autenticação automática realizada com sucesso",
  "token": {
    "id": 1,
    "expiresAt": "2024-01-15T10:30:00.000Z",
    "isActive": true
  }
}
```

### 3.2. Verificar Status dos Tokens

```http
GET /marketplace/olx/auth/status
```

**Descrição:** Verifica o status atual dos tokens da OLX.

**Resposta de Sucesso:**
```json
{
  "marketplace": "OLX",
  "hasTokens": true,
  "hasActiveToken": true,
  "isExpired": false,
  "expiresInMinutes": 360,
  "message": "Token válido por mais 360 minutos.",
  "action": "valid",
  "token": {
    "id": 1,
    "isActive": true,
    "expiresAt": "2024-01-15T10:30:00.000Z",
    "createdAt": "2024-01-15T04:30:00.000Z"
  }
}
```

### 3.3. Publicar Produto (Automático)

```http
POST /marketplace/olx/ads/import
Content-Type: application/json

{
  "id": 123,
  "name": "Produto Teste",
  "partNumber": "ABC123",
  "brand": { "name": "Marca Teste" },
  "category": { "name": "Auto Parts" },
  "inventories": [
    {
      "price": 100.00,
      "quantity": 5
    }
  ],
  "productImages": [
    { "url": "https://example.com/image1.jpg" }
  ],
  "productTitles": [
    { "title": "Título do Produto" }
  ]
}
```

## 4. Fluxo de Funcionamento

### 4.1. Primeira Execução

1. **Configurar Variáveis de Ambiente**
   - Definir `OLX_CLIENT_ID`
   - Definir `OLX_CLIENT_SECRET_<CLIENT_ID>`
   - Definir `OLX_REDIRECT_URI`

2. **Configurar Banco de Dados**
   - Marketplace OLX deve ter `appId` configurado
   - Tabela `marketplace_tokens` deve existir

3. **Executar Autenticação Automática**
   ```bash
   curl -X POST http://localhost:3000/marketplace/olx/auth/auto-authenticate
   ```

### 4.2. Uso Normal

1. **Verificar Status**
   ```bash
   curl -X GET http://localhost:3000/marketplace/olx/auth/status
   ```

2. **Publicar Produto**
   ```bash
   curl -X POST http://localhost:3000/marketplace/olx/ads/import \
     -H "Content-Type: application/json" \
     -d '{"id": 123, "name": "Produto Teste", ...}'
   ```

## 5. Tratamento de Erros

### 5.1. Credenciais Não Configuradas

**Erro:**
```json
{
  "error": "Credenciais da OLX não configuradas. Client ID: undefined"
}
```

**Solução:**
- Verificar se `OLX_CLIENT_ID` está definido no `.env`
- Verificar se `OLX_CLIENT_SECRET_<CLIENT_ID>` está definido

### 5.2. Marketplace Não Encontrado

**Erro:**
```json
{
  "error": "Marketplace OLX não encontrado"
}
```

**Solução:**
- Executar query SQL para criar/atualizar marketplace OLX
- Verificar se `appId` está configurado

### 5.3. Token Expirado

**Erro:**
```json
{
  "error": "Token da OLX expirado e não pode ser renovado automaticamente"
}
```

**Solução:**
- Executar autenticação automática novamente
- Verificar se as credenciais ainda são válidas

## 6. Monitoramento

### 6.1. Logs Importantes

- `Iniciando autenticação automática para OLX`
- `Autenticação automática para OLX realizada com sucesso`
- `Token expirado para OLX. Tentando reautenticação automática`
- `Erro na autenticação automática para OLX`

### 6.2. Verificações Periódicas

Recomenda-se verificar o status dos tokens periodicamente:

```bash
# Verificar status a cada hora
0 * * * * curl -X GET http://localhost:3000/marketplace/olx/auth/status
```

## 7. Segurança

### 7.1. Proteção de Credenciais

- Nunca commitar o arquivo `.env` no repositório
- Usar variáveis de ambiente em produção
- Rotacionar credenciais periodicamente

### 7.2. Logs Sensíveis

- Tokens não são logados em produção
- Apenas IDs e status são registrados
- Logs de erro não incluem credenciais

## 8. Troubleshooting

### 8.1. Problemas Comuns

1. **Erro de Compilação**
   - Verificar se todas as dependências estão instaladas
   - Executar `npm run build`

2. **Erro de Conexão**
   - Verificar se o banco de dados está acessível
   - Verificar se as migrations foram executadas

3. **Erro de Autenticação**
   - Verificar se as credenciais da OLX estão corretas
   - Verificar se o `appId` está configurado no banco

### 8.2. Comandos Úteis

```bash
# Verificar status da aplicação
curl -X GET http://localhost:3000/marketplace/olx/health

# Verificar logs
tail -f logs/application.log

# Testar autenticação
curl -X POST http://localhost:3000/marketplace/olx/auth/auto-authenticate
``` 