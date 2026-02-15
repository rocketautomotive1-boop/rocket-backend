# Marketplace Integration - Documentação

Este documento descreve a estrutura e funcionamento do projeto de integração com marketplaces desenvolvido com NestJS.

## Visão Geral

O projeto foi desenvolvido para integrar produtos com diversos marketplaces (Mercado Livre, Shopee, Amazon, Magazine Luiza, Via Varejo, Americanas, Yampi, OLX, Aliexpress), utilizando filas com RabbitMQ para gerenciar o fluxo de cadastros e atualizações.

## Estrutura do Projeto

```
marketplace-integration/
├── src/
│   ├── auth/                  # Módulo de autenticação
│   ├── common/                # Utilitários e componentes comuns
│   ├── config/                # Configurações da aplicação
│   ├── marketplace/           # Módulo de marketplaces
│   │   ├── entities/          # Entidades relacionadas aos marketplaces
│   │   ├── marketplace.controller.ts
│   │   ├── marketplace.module.ts
│   │   └── marketplace.service.ts
│   ├── product/               # Módulo de produtos
│   │   ├── entities/          # Entidades relacionadas aos produtos
│   │   ├── product.controller.ts
│   │   ├── product.module.ts
│   │   └── product.service.ts
│   ├── queue/                 # Módulo de filas
│   │   ├── entities/          # Entidades relacionadas às filas
│   │   ├── queue.controller.ts
│   │   ├── queue.module.ts
│   │   ├── queue.processor.ts
│   │   └── queue.service.ts
│   ├── app.module.ts          # Módulo principal da aplicação
│   └── main.ts                # Ponto de entrada da aplicação
└── package.json               # Dependências do projeto
```

## Modelo de Dados

### Marketplace

Armazena informações sobre os marketplaces integrados:
- ID, nome, appId, URL da API, configurações
- Relacionamentos com requisitos, tokens e produtos

### MarketplaceRequirement

Define os requisitos mínimos para cada marketplace:
- Campo, nome de exibição, tipo de dado, regras de validação
- Relacionamento com marketplace

### MarketplaceToken

Gerencia tokens de acesso para cada marketplace:
- Token de acesso, token de atualização, data de expiração
- Relacionamento com marketplace

### ProductMarketplace

Associa produtos a marketplaces:
- ID externo, status, mensagem de status, dados específicos
- Relacionamentos com produto e marketplace

### Product

Representa os produtos a serem integrados:
- Informações básicas (código, descrição, dimensões)
- Informações específicas (marca, categoria, garantia)
- Relacionamentos com marketplaces e filas

### QueueRecord

Registra operações em filas para relatórios:
- Nome da fila, status, mensagem de erro, payload
- Relacionamentos com produto e marketplace

## Fluxo de Integração

1. **Cadastro de Produtos**:
   - Produtos são cadastrados ou atualizados via API
   - Atualizações podem ser feitas por partes (imagens, títulos, categoria)
   - Sistema verifica requisitos mínimos para cada marketplace

2. **Filas de Processamento**:
   - Operações são adicionadas a filas específicas (RabbitMQ)
   - Cada operação é registrada no banco para relatórios
   - Processadores consomem as filas e executam as operações

3. **Integração com Marketplaces**:
   - Tokens de acesso são gerenciados automaticamente
   - Operações específicas para cada marketplace
   - Tratamento de erros e tentativas automáticas

4. **Relatórios**:
   - Registros de filas permitem gerar relatórios por data e marketplace
   - Status e erros são registrados para análise

## APIs Disponíveis

### Produtos
- `GET /products` - Listar todos os produtos
- `GET /products/:id` - Obter um produto pelo ID
- `POST /products` - Criar um novo produto
- `PUT /products/:id` - Atualizar um produto
- `PUT /products/:id/images` - Atualizar imagens de um produto
- `PUT /products/:id/titles` - Atualizar títulos de um produto
- `PUT /products/:id/category` - Atualizar categoria de um produto
- `GET /products/:id/marketplace-requirements/:marketplaceId` - Verificar requisitos
- `POST /products/:id/marketplace/:marketplaceId` - Adicionar produto a marketplace
- `PUT /products/:id/inventory` - Atualizar inventário de um produto

### Marketplaces
- `GET /marketplaces` - Listar todos os marketplaces
- `GET /marketplaces/:id` - Obter um marketplace pelo ID
- `POST /marketplaces` - Criar um novo marketplace
- `PUT /marketplaces/:id` - Atualizar um marketplace
- `GET /marketplaces/:id/requirements` - Obter requisitos de um marketplace
- `POST /marketplaces/:id/token` - Salvar token de acesso
- `POST /marketplaces/:id/refresh-token` - Atualizar token de acesso
- `GET /marketplaces/product/:productId` - Obter marketplaces de um produto

### Filas
- `GET /queues/records` - Listar registros de filas
- `GET /queues/records/:id` - Obter um registro de fila pelo ID
- `GET /queues/statistics` - Obter estatísticas das filas
- `POST /queues/retry/:id` - Tentar novamente um registro de fila

## Configuração e Execução

1. Instalar dependências:
   ```
   npm install
   ```

2. Configurar variáveis de ambiente (.env):
   ```
   DB_HOST=localhost
   DB_PORT=3306
   DB_USERNAME=root
   DB_PASSWORD=password
   DB_DATABASE=marketplace_integration
   REDIS_HOST=localhost
   REDIS_PORT=6379
   ```

3. Iniciar a aplicação:
   ```
   npm run start
   ```

4. Acessar a documentação da API:
   ```
   http://localhost:3000/api
   ```

## Próximos Passos

1. Implementar adaptadores específicos para cada marketplace
2. Configurar sistema de logs detalhados
3. Implementar testes automatizados
4. Configurar monitoramento de filas e processos
