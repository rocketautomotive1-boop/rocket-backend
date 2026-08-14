# Absorver `microservices/moderations` no backend (webhook `items` + reconciler `/infractions`)

**Data:** 2026-06-21
**Branch sugerida:** `feat/moderation-into-backend` (no `backend/` — repo próprio)
**Status:** plano, não implementado

## Problema

`microservices/moderations` é um satélite sem dados/auth/webhook próprios: lê a API do ML,
classifica uma string e **escreve cross-DB** em `products`/`listings` do backend. Defeitos:

1. **Polling aditivo, sem fonte da verdade.** `runAllChecks` (a cada 30min) só processa as
   infrações *presentes agora*. Nunca **fecha** uma infração resolvida no ML → estado local
   diverge e fica preso em `pending_removal`/`warning`.
2. **Acoplamento invertido.** O MS muta o domínio do produto (`$unset category`, `warnings[]`,
   deletar anúncio) escrevendo direto no Mongo do backend.
3. **Hardwired ML.** `InfractionType`/`filter_subgroup` são vocabulário cru do ML; auth é um
   `userId` único. Sem caminho multi-marketplace.

## Achado que define a arquitetura (investigado 2026-06-21)

**O ML NÃO tem topic de webhook `moderations`.** Topics confirmados: `items`, `items_prices`,
`questions`, `orders_v2`, `shipments`, `payments`, `messages`, `claims`, `item_competition`,
`public_offers`, `stock_locations`, `catalog_suggestions`, `stock_fulfillment`.
Moderação descobre-se por **`/infractions` (query ativa)**; o webhook que existe é **`items`**
(o `sub_status` do item muda ao ser moderado).

⇒ **Inverso de orders:** o **reconciler `/infractions` é PRIMÁRIO** (cursor adaptativo, igual
`order-reconciler`); o webhook **`items` é gatilho de baixa latência** que adianta um scan do
item, não a fonte da verdade.

## Decisões (fechadas com o usuário)

- **Topologia:** absorver no `backend/src/moderation/` (como `order/` e `questions/`). Deletar o MS.
- **Dono do estado:** o **backend** (coleção própria `moderation_state`). MS deixa de existir.
- **Domínio:** moderação grava em `moderation_state` e aplica ações no domínio **dentro do
  backend** (mesma transação possível); nada de escrita cross-DB externa.

### Decisão de boundary: o que sai do listing e o que fica (contaminação)

Hoje o handler enfia **~17 chaves de moderação** dentro de `listing.marketplaceData` (blob `Object`
sem schema): `moderationReason/Remedy/FilterSubgroup/SuggestedCategories`, `closedReason/At/ExternalId`,
`wrongCategoryOriginalCategoryId`, `removal_attempts/last_attempt_at`, e o par duplicado
`compatibilityModeration*`. `marketplace-issues.service.ts:192-227` gasta ~35 linhas de `?.` defensivo
remontando isso, com **prefixos diferentes pro mesmo dado** (`moderationInfractionId` vs
`compatibilityModerationInfractionId`). Essa é a "contaminação".

Corte (padrão bigtech — single source of truth por eixo de propriedade):

- **`moderation_state` é dona da EVIDÊNCIA** (fato do ML, ciclo de vida open/resolved): reason, remedy,
  subgroup, suggestedCategoryIds, infractionId, blockedCategoryId, detectedAt, resolvedAt,
  removal_attempts. Chave única `(marketplaceId, accountId, externalId)`.
- **O listing fica só com a CONSEQUÊNCIA operacional**: `status` (`pending_removal`) + `syncIssue`
  (`blocked/classifier/retryable/requiredResolutionSignals`). **`syncIssue` NÃO migra**: é contrato
  do orchestrator (`sync-issue.policy.ts`; moderação é só uma das origens — vide `AUTH_MISSING`,
  `PRODUCT_VALIDATION_FAILED`). Movê-lo acoplaria o sync a moderação — o acoplamento invertido que
  estamos desfazendo. A camada de moderação **escreve** o `syncIssue`; o orchestrator **consome**.
- **`product`**: `$unset category` + warning continuam (decisão de domínio do produto), mas a UI lê
  reason/remedy/sugestões de `moderation_state`, não de `product.warnings` inchado.

### Decisão de leitura da UI (`marketplace-issues`)

`marketplace-issues.service` passa a **juntar listing + moderation_state por `externalId`** (sem
espelho de longo prazo — espelho é a própria contaminação). Ordem segura: (1) escrever em
moderation_state, (2) trocar a leitura da UI para o join, (3) **verificar a tela no app**, (4) só então
parar de escrever os campos de evidência no listing. Remoção dos campos = ÚLTIMO passo.

## Arquitetura-alvo

```
ML webhook topic "items" → backend WebhookController (assina + dedup via inbox — JÁ EXISTE)
  → MercadoLivreAdapter.parse() → kind:'moderation' quando sub_status é de moderação   [ADICIONAR]
  → WebhookDispatcher emite MODERATION_PROBE_REQUESTED                                   [ADICIONAR]
  → ModerationIngestService: GET /moderations/last_moderation/{item} + classifica → canonical
       → upsert moderation_state (marketplaceId, accountId, externalId)
       → handler aplica no domínio (unset category / warning / pending_removal / delete)

ModerationReconciler (PRIMÁRIO, padrão order-reconciler):
  por (marketplace, conta) via MarketplaceTokenBrokerService:
    GET /infractions/{userId} → set de infrações ATIVAS
    diff vs moderation_state local:
      - nova/divergente → ingest (mesmo pipeline do webhook)
      - sumiu do ML     → RESOLVER: limpar pending_removal/warning/syncIssue + emitir re-publish
    cursor adaptativo (floor 5min ↔ ceiling 20min), checkpoint por (marketplace, conta)
```

## Pontos de extensão concretos (já existentes)

- Webhook ingress completo: `backend/src/webhook/` (inbox idempotente, signature, dispatcher, registry).
- Adapter ML: `backend/src/webhook/adapters/mercadolivre.adapter.ts` — hoje `items` → `kind:'ignore'`.
- Comandos de domínio: `backend/src/webhook/events/webhook.events.ts` (`WEBHOOK_DOMAIN_COMMANDS`).
- Padrão reconciler: `backend/src/order/reconcile/order-reconciler.service.ts` + `reconcile-cursor.ts`
  (`RECONCILE`, `nextInterval`, `maxCursor`, `isStatusDivergent`).
- Multi-conta: `MarketplaceTokenBrokerService.listAccountsWithToken(marketplaceId)`.
- Config via cache: `MarketplaceConfigCacheService` / `MarketplaceRegistryService.findAll()`.
- Token ML ao vivo: ler via broker (NÃO cache — token é volátil, vide CLAUDE.md).

> ⚠️ Há um `services/item-moderation.service.ts` no orchestrator com **zero referências** que
> duplica isto (vide `docs/.../2026-06-07-orchestrator-backend-boundary-cleanup-design.md`).
> Deletar como parte do cutover.

## Fases (bottom-up, cada uma verde antes da próxima)

### Fase 0 — Modelo canônico + provider ML (puro, sem I/O de domínio)
- `moderation/providers/canonical-moderation.ts`: `CanonicalModeration { marketplace, externalId,
  type: ModerationType, subgroup, reason?, remedy?, suggestedCategories?, raw }`.
- `moderation/providers/mercadolivre-moderation.provider.ts`: encapsula `SUBGROUP_TO_TYPE` +
  `buildClassified` (migra `infraction.classifier.ts`, hoje no MS). Interface `ModerationProvider`
  para futuros marketplaces.
- **TDD:** porta os specs do MS (`infraction.classifier`/`infractions.service`) para o provider.
- ✅ Verde: `npm test` no backend cobrindo o provider.

### Fase 1 — Schema `moderation_state` (coleção própria) + repo
- `moderation/schemas/moderation-state.schema.ts`: chave única `(marketplaceId, accountId, externalId)`;
  campos `status (open|resolved)`, `type`, `reason`, `remedy`, `suggestedCategoryIds`,
  `infractionId`, `detectedAt`, `resolvedAt`, `listingId`, `productId`.
- `moderation/moderation.repository.ts`: `upsertOpen`, `findOpenByExternalIds`, `markResolved`.
- **TDD:** repo contra mongo-memory-server (`--runInBand`, vide memória de contenção).

### Fase 2 — Handlers migram para o domínio backend
- Mover `wrong-category.handler.ts` / `missing-compatibility.handler.ts` para `moderation/handlers/`,
  operando sobre **models do backend** (não os schemas duplicados do MS) e sobre `moderation_state`.
- Notificações: manter `amqp.publish('rocket.notifications', ...)` (contrato já existe).
- **Idempotência preservada** (já têm guard por `classifier`/`infractionId`).
- **TDD:** specs migrados (`wrong-category.handler.spec`, `missing-compatibility.handler.spec`).

### Fase 3 — Ingest service (consome canonical → state + handler)
- `moderation/ingest/moderation-ingest.service.ts`: dado `(marketplace, externalId, accountId)` →
  busca listing/produto → resolve provider → classifica → `repo.upsertOpen` → roda handler.
  É o ponto único chamado por webhook E reconciler (espelha `OrderIngestService`).

### Fase 4 — Reconciler PRIMÁRIO (`/infractions`, diff abre+fecha)
- `moderation/reconcile/moderation-reconciler.service.ts` + `moderation-reconcile-checkpoint.schema.ts`,
  clonando `order-reconciler` (cursor adaptativo, multi-conta via broker).
- **Diferença-chave vs orders:** além de abrir/atualizar, **fecha** — para cada `moderation_state`
  com `status=open` cujo `externalId` **não** está no set de `/infractions`: `markResolved` +
  limpar `pending_removal`/`warning`/`syncIssue` + emitir `product.sync.requested`
  (`resolutionSignal: 'moderation_resolved'`).
- `RECONCILER_ENABLED=false` desliga (igual orders).
- **TDD:** caso "infração some → state vira resolved e domínio é limpo".

### Fase 5 — Webhook `items` como gatilho de baixa latência
- `mercadolivre.adapter.ts`: quando `topic==='items'` e o item está sob moderação, retornar
  `kind:'moderation'` com `externalId`/`externalUserId`. (Avaliar: o payload `items` traz
  `sub_status`? Se não, o adapter marca probe e o ingest consulta o item — confirmar no Fase 5.)
- `webhook-adapter.interface.ts`: adicionar `'moderation'` em `WebhookKind`.
- `webhook.events.ts`: `MODERATION_PROBE_REQUESTED` + tipo do comando.
- `webhook-dispatcher.service.ts`: ramo `case 'moderation'` → emite o comando → ingest.
- **TDD:** specs do adapter (hoje `items → ignore`) e do dispatcher.

### Fase 6 — Cutover e remoção
- Listener que liga `MODERATION_PROBE_REQUESTED` ao ingest; registrar reconciler no módulo;
  `MarketplaceConfigCacheService` para resolver marketplaceId.
- **Verificação fim-a-fim** (skill `verify`/`run`): com `INTERNAL_API_KEY`/token ML real, simular
  webhook `items` de item moderado → state `open` + ação aplicada; depois resolver no ML (ou mock)
  → reconciler fecha o state + limpa domínio.
- Remover: `microservices/moderations/` inteiro; `orchestrator/.../item-moderation.service.ts`
  (dead code); referências em `CLAUDE.md`, `docker-compose`, scripts `ms:*`.
- Atualizar `CLAUDE.md` (seção "Moderation Microservice" → "Moderation (backend)").

## Riscos / a confirmar durante a implementação
- **Payload do webhook `items`**: confirma se traz `sub_status` (decide Fase 5 — probe direto vs
  consulta extra ao item).
- **`/infractions` é por `userId` (conta)**: o reconciler precisa iterar contas via broker — já é
  o padrão do `order-reconciler`, reusar.
- **Migração de dados**: listings hoje em `pending_removal`/`warnings` escritos pelo MS continuam
  válidos (mesmo Mongo) — sem migração destrutiva; o primeiro reconciler reconcilia o que sobrou.
- **Git topology**: tudo no `backend/` (repo próprio, branch própria). MS removido é commit no
  **root** repo. Não misturar.

## Definição de pronto
- Reconciler abre **e fecha** infrações (divergência resolvida).
- Zero escrita cross-DB; backend é dono de `moderation_state`.
- `microservices/moderations` deletado; suíte do backend verde; verificação fim-a-fim feita.
- Multi-marketplace destravado via `ModerationProvider` (ML é só o primeiro).
