# Configuração do Arquivo .env

## Problema Identificado

O erro "Credenciais da OLX não configuradas. Client ID: null" indica que o arquivo `.env` não está sendo carregado corretamente ou não existe.

## Solução

### 1. Criar arquivo .env na raiz do projeto

Crie um arquivo `.env` na pasta `marketplace-integration/` com o seguinte conteúdo:

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
DB_HOST=localhost
DB_PORT=3306
DB_USERNAME=root
DB_PASSWORD=
DB_DATABASE=marketplace_integration
DB_SYNCHRONIZE=false

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

### 2. Verificar se o arquivo está sendo carregado

Após criar o arquivo `.env`, reinicie o servidor e teste o endpoint:

```bash
# Reiniciar o servidor
npm run start:dev

# Testar configurações
curl -X GET http://localhost:3000/marketplace/olx/auth/config-test
```

### 3. Estrutura de pastas correta

Certifique-se de que o arquivo `.env` está na estrutura correta:

```
marketplace-integration/
├── .env                    # ← AQUI
├── package.json
├── src/
├── dist/
└── ...
```

### 4. Verificar carregamento do dotenv

O arquivo `main.ts` deve carregar o dotenv. Verifique se existe esta linha:

```typescript
import { config } from 'dotenv';
config(); // Carrega o arquivo .env
```

### 5. Teste de configuração

Use o endpoint de teste para verificar se as variáveis estão sendo carregadas:

```bash
curl -X GET http://localhost:3000/marketplace/olx/auth/config-test
```

Resposta esperada:
```json
{
  "message": "Teste de configurações da OLX",
  "configs": {
    "clientId": "your_client_id_here",
    "clientSecret": "your_client_secret_here",
    "redirectUri": "http://localhost:3000/oauth/callback",
    "allEnvVars": {
      "OLX_CLIENT_ID": "your_client_id_here",
      "OLX_REDIRECT_URI": "http://localhost:3000/oauth/callback",
      "NODE_ENV": "development",
      "PORT": "3000"
    }
  }
}
```

### 6. Troubleshooting

Se as variáveis ainda aparecem como `null`:

1. **Verificar se o arquivo .env existe:**
   ```bash
   ls -la marketplace-integration/.env
   ```

2. **Verificar se o dotenv está instalado:**
   ```bash
   npm list dotenv
   ```

3. **Verificar se o dotenv está sendo importado no main.ts:**
   ```typescript
   import { config } from 'dotenv';
   config();
   ```

4. **Testar com variáveis hardcoded temporariamente:**
   ```typescript
   // No OLXAuthService, temporariamente:
   const clientId = 'your_client_id_here';
   const clientSecret = 'your_client_secret_here';
   ```

### 7. Exemplo de .env funcional

```env
# OLX Configuration
OLX_CLIENT_ID=abc123def456
OLX_CLIENT_SECRET_abc123def456=xyz789uvw012
OLX_REDIRECT_URI=http://localhost:3000/oauth/callback

# Database
DB_HOST=localhost
DB_PORT=3306
DB_USERNAME=root
DB_PASSWORD=password123
DB_DATABASE=marketplace_integration

# Server
PORT=3000
NODE_ENV=development
JWT_SECRET=my_secret_key_here
``` 