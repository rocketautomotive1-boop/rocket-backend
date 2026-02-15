# Rotas Disponíveis na API de Integração com Marketplaces

## Autenticação

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/auth/register` | Registrar novo usuário |
| POST | `/auth/login` | Autenticar usuário e obter token JWT |
| GET | `/auth/profile` | Obter perfil do usuário autenticado |

## Marketplaces

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/marketplace` | Listar todos os marketplaces |
| GET | `/marketplace/:id` | Obter marketplace por ID |
| POST | `/marketplace` | Criar novo marketplace |
| PUT | `/marketplace/:id` | Atualizar marketplace |
| DELETE | `/marketplace/:id` | Excluir marketplace |
| GET | `/marketplace/:id/requirements` | Listar requisitos do marketplace |
| POST | `/marketplace/:id/requirements` | Adicionar requisito ao marketplace |
| PUT | `/marketplace/:id/requirements/:requirementId` | Atualizar requisito do marketplace |
| DELETE | `/marketplace/:id/requirements/:requirementId` | Excluir requisito do marketplace |
| POST | `/marketplace/:id/authenticate` | Autenticar com marketplace (OAuth) |
| POST | `/marketplace/:id/refresh-token` | Renovar token de marketplace |

## Produtos

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/product` | Listar todos os produtos |
| GET | `/product/:id` | Obter produto por ID |
| POST | `/product` | Criar novo produto |
| PUT | `/product/:id` | Atualizar produto |
| DELETE | `/product/:id` | Excluir produto |
| POST | `/product/:id/images` | Atualizar imagens do produto |
| POST | `/product/:id/titles` | Atualizar títulos do produto |
| POST | `/product/:id/category` | Atualizar categoria do produto |
| GET | `/product/:id/marketplaces` | Listar integrações do produto com marketplaces |
| POST | `/product/:id/marketplace/:marketplaceId` | Integrar produto com marketplace |
| DELETE | `/product/:id/marketplace/:marketplaceId` | Remover integração do produto com marketplace |
| PUT | `/product/:id/marketplace/:marketplaceId` | Atualizar integração do produto com marketplace |
| GET | `/product/:id/marketplace/:marketplaceId/status` | Verificar status da integração do produto com marketplace |

## Categorias

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/categories/marketplace/:marketplaceId` | Listar categorias de um marketplace |
| GET | `/categories/marketplace/:marketplaceId/category/:externalId` | Obter categoria por ID externo |
| GET | `/categories/category/:id` | Obter categoria por ID |
| POST | `/categories/marketplace/:marketplaceId/sync` | Sincronizar categorias de um marketplace |
| POST | `/categories/mapping` | Criar mapeamento de categoria |
| PUT | `/categories/mapping/:id` | Atualizar mapeamento de categoria |
| DELETE | `/categories/mapping/:id` | Excluir mapeamento de categoria |
| GET | `/categories/mapping/internal/:internalCategoryId` | Buscar mapeamentos por categoria interna |
| GET | `/categories/mapping/internal/:internalCategoryId/marketplace/:marketplaceId` | Buscar mapeamento por categoria interna e marketplace |
| GET | `/categories/mapping/marketplace-category/:marketplaceCategoryId` | Buscar mapeamentos por categoria de marketplace |

## Filas

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/queue` | Listar todas as filas |
| GET | `/queue/:id` | Obter fila por ID |
| POST | `/queue/product/:productId/marketplace/:marketplaceId` | Adicionar produto à fila de integração |
| DELETE | `/queue/:id` | Remover item da fila |
| GET | `/queue/status` | Obter status das filas |
| GET | `/queue/report` | Gerar relatório de filas |
| GET | `/queue/report/marketplace/:marketplaceId` | Gerar relatório de filas por marketplace |
| GET | `/queue/report/date/:date` | Gerar relatório de filas por data |

## Webhooks

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/webhooks/mercadolivre/:topic` | Receber notificações do Mercado Livre |
| POST | `/webhooks/shopee/:topic` | Receber notificações da Shopee |
| POST | `/webhooks/amazon/:topic` | Receber notificações da Amazon |
| POST | `/webhooks/magalu/:topic` | Receber notificações da Magazine Luiza |
| POST | `/webhooks/b2w/:topic` | Receber notificações da B2W (Americanas, Submarino, Shoptime) |
| POST | `/webhooks/viavarejo/:topic` | Receber notificações da Via Varejo (Casas Bahia, Ponto Frio) |
| POST | `/webhooks/yampi/:topic` | Receber notificações da Yampi |
| POST | `/webhooks/olx/:topic` | Receber notificações da OLX |
| POST | `/webhooks/aliexpress/:topic` | Receber notificações da AliExpress |

## Monitoramento

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/monitoring/queues` | Visualizar status das filas |
| GET | `/monitoring/metrics` | Obter métricas do sistema |
| GET | `/monitoring/health` | Verificar saúde do sistema |
| GET | `/monitoring/logs` | Visualizar logs do sistema |
| POST | `/monitoring/clean-queues` | Limpar filas antigas |

## Administração

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/admin/queues` | Interface de administração das filas (Bull Board) |
| GET | `/admin/users` | Listar usuários do sistema |
| POST | `/admin/users` | Criar novo usuário administrativo |
| PUT | `/admin/users/:id` | Atualizar usuário |
| DELETE | `/admin/users/:id` | Excluir usuário |
