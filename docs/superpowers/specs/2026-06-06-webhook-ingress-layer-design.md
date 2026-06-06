# Webhook Ingress Layer — Design (reescrita raiz)

**Data:** 2026-06-06
**Escopo:** `backend/src/webhook` — reescrita completa da primeira camada de entrada de webhooks.
**Objetivo:** Camada abstraída, centralizada, genérica e plug-in, pronta para escalar horizontalmente, sem remendos. Zero conhecimento de marketplaces no core.

---

## 1. Contexto e motivação

A camada atual tem uma fundação madura no fim do pipeline (inbox com dedupe, retry/backoff, claim atômico, separação intent/execution via eventos), mas a entrada é "uma função por marketplace": controller com 10 handlers quase idênticos, `WebhookService` com 10 métodos `processXWebhook`, registry que é um `switch` de 10 `case`, e um guard chamado `WebhookSignatureGuard` que **não verifica assinatura nenhuma**.

### Problemas de raiz a resolver (não remendar)

1. **Guard que não valida** — `WebhookSignatureGuard` só checa allowlist e sempre retorna `true`.
2. **Verificação fail-open** — adapters fazem `if (!secret) return true;`; falta de env var → aceita tudo.
3. **Crypto reimplementado 4×** — ML usa `timingSafeEqual` (frágil a length mismatch), Shopee usa `===` (timing attack), OLX/Amazon não validam.
4. **Registry = switch** — adicionar marketplace exige tocar em 5 arquivos.
5. **Controller com 10 handlers** — ~210 linhas, diferindo só no header de assinatura.
6. **3 fontes de verdade duplicadas** para "o que é topic de pedido" (policy, dispatcher, extractOrderId), já divergentes.
7. **Dedupe quebrado** — chave inclui o payload inteiro (`raw: payload`); reenvios legítimos não deduplicam.
8. **Persistência híbrida** — só ML persiste no inbox; os outros 9 vão por EventEmitter em memória (perda em crash entre o 200 e o processamento).
9. **Sem reaper** — itens travados em `processing` nunca são recuperados (impede escala horizontal).
10. **`payload: any` em toda a cadeia** — sem contrato/Zod, contra a convenção do projeto.
11. **`LISTING_UPDATED`** — comando definido sem nenhum consumidor (código morto).

### Princípio central

> **O core conhece `kind` (order/question/...), nunca marketplaces.** Todo conhecimento específico (header de assinatura, segredo, parsing, mapeamento de topic) vive dentro do adapter daquele marketplace. Adicionar um marketplace = criar **uma** classe com um decorator. Zero edição no core.

### Contratos a preservar (fronteira a jusante — NÃO mudar)

Consumidores existentes que devem continuar funcionando sem alteração:

- `ORDER_SYNC_REQUESTED` → `order/listeners/order-webhook-command.listener.ts:23`
- `ORDER_PACK_SYNC_REQUESTED` → `order/listeners/order-webhook-command.listener.ts:34`
- `QUESTION_INGEST_REQUESTED` → `questions/questions.service.ts:38`

`LISTING_UPDATED` **não** tem consumidor → removido no cleanup.

### Marketplaces

Manter os 10 atuais (mercadolivre, shopee, amazon, magalu, b2w, viavarejo, yampi, olx, aliexpress, tiktokshop). Cleanup foca em código morto interno, não em remover marketplaces — a nova arquitetura plug-in torna mantê-los barato.

---

## 2. Arquitetura e fluxo

```
POST /webhooks/:marketplace/:topic          ← 1 endpoint genérico, HTTP 200 (quase) sempre
        │
        ▼
WebhookIngressGuard                          ← resolve adapter por :marketplace (registry)
        │                                      404 se marketplace desconhecido
        │                                      401 se assinatura inválida/ausente (FAIL-CLOSED)
        ▼
WebhookIngressService
   1. adapter.parse(ctx) → NormalizedWebhook { kind, eventId, externalId?, resource?, raw }
   2. kind === 'ignore'   → ACK 200, fim (não persiste)
   3. parse lança         → inbox.append(status:'dead', kind:'unparseable') + ACK 200
   4. inbox.append(normalized)  ← persiste SEMPRE antes do ACK; dedupe por eventId
        ▼  ← ACK 200 ao marketplace AQUI (após persistir)
WebhookInboxWorker (poll + lease + reaper)
   - claim atômico {owner, leaseUntil}
   - reaper: leaseUntil vencido → reclaim
   - retry backoff; attempts ≥ max → status 'dead' + métrica webhook_inbox_dead_total
        ▼
WebhookDispatcher (genérico)
   - switch SOMENTE em normalized.kind:
       'order'      → ORDER_SYNC_REQUESTED
       'order_pack' → ORDER_PACK_SYNC_REQUESTED
       'question'   → QUESTION_INGEST_REQUESTED
   - core NUNCA conhece nome de marketplace
        ▼
order-webhook-command.listener / questions.service   ← INALTERADOS
```

A verificação de assinatura é a única coisa que roda **antes** do ACK além do parse+persist. Tudo que pode falhar de forma transitória (downstream fora) acontece no worker, com retry — nunca devolvendo 5xx ao marketplace.

---

## 3. Componentes

Cada um com propósito único, fronteira clara e testável isoladamente.

### 3.1 `WebhookAdapter` (interface) + `@RegisterWebhookAdapter()` (decorator)

```typescript
interface WebhookAdapter {
  readonly marketplace: string;             // 'mercadolivre' — só o adapter sabe seu nome
  readonly signatureScheme: SignatureScheme; // descreve COMO verificar (declarativo)
  parse(ctx: WebhookContext): NormalizedWebhook; // função pura, com Zod próprio
}
```

Auto-registro via `DiscoveryService` do Nest no boot (lê metadata do decorator). Adicionar marketplace = 1 classe com o decorator. **Zero edição no core.**

### 3.2 `WebhookAdapterRegistry`

Substitui o `switch`. `Map<string, WebhookAdapter>` populado por discovery no boot. API: `get(marketplace): WebhookAdapter | undefined`, `has(marketplace): boolean`, `list(): string[]`. Nenhum `case`.

### 3.3 `SignatureVerifier` (crypto central)

Única implementação de verificação. Recebe o `SignatureScheme` declarado pelo adapter:

```typescript
type SignatureScheme =
  | { type: 'none' }
  | { type: 'hmac-sha256'; header: string; secretEnv: string; baseString: 'rawBody' | ((ctx) => string) }
  | { type: 'aws-sns' };
```

Regras:
- HMAC: `timingSafeEqual` **com checagem de length antes** (length diferente → inválido, sem throw). Mata o `===` da Shopee (timing attack).
- **Fail-closed:** scheme exige segredo e a env var está ausente → **rejeita** (não `return true`). O default seguro é negar.
- `aws-sns`: valida assinatura X.509 do SNS antes de confirmar `SubscribeURL`.
- `none`: explícito por adapter (ex.: OLX), nunca um default implícito.

### 3.4 `WebhookContext`

Objeto imutável `{ marketplace, topic, headers, rawBody, payload }`. Passado a `parse`/`verify`. Centraliza acesso ao request; adapters não tocam em `@Req()`.

### 3.5 `NormalizedWebhook` (evento canônico)

```typescript
interface NormalizedWebhook {
  kind: 'order' | 'order_pack' | 'question' | 'ignore';
  eventId: string;        // dedupe ESTÁVEL (ver §4)
  externalId?: string;    // orderId / packId / questionId
  resource?: string;
  raw: unknown;           // payload original, auditoria
}
```

`kind: 'ignore'` nunca chega ao inbox nem ao dispatcher.

### 3.6 `WebhookIngressGuard`

Resolve adapter via registry + chama `SignatureVerifier`. Fail-closed real. Substitui o guard atual (allowlist + `return true`).

### 3.7 `WebhookIngressService`

Orquestra: parse → (ignore? fim : (unparseable? dead : inbox.append)). ACK 200 após persistir. Substitui os 10 `processXWebhook` e dissolve o `WebhookService`.

### 3.8 `WebhookInbox` (schema + service)

Universal. Dedupe por `eventId` (unique). Ver schema completo em §4.

### 3.9 `WebhookInboxWorker` (poll + lease + reaper)

- Claim atômico grava `owner` (id da réplica) + `leaseUntil = now + LEASE_MS`.
- Reaper: item em `processing` com `leaseUntil < now` volta a `pending` (reclamável por outra réplica). Resolve travamento e habilita escala horizontal.
- Retry backoff exponencial; `attempts ≥ maxAttempts` → `dead`.

### 3.10 `WebhookDispatcher` (genérico)

`switch (normalized.kind)` → emite um dos 3 comandos. Sem tabela de marketplace, sem `extractOrderId` por marketplace (a extração já foi feita no `parse` do adapter).

### 3.11 `WebhookMetrics`

Contadores estruturados: `webhook_received_total{marketplace,kind}`, `webhook_rejected_total{marketplace,reason}`, `webhook_inbox_dead_total{marketplace,kind}`, profundidade/idade da fila. Implementação alinhada ao que o projeto já usa para métricas; se não houver mecanismo, contadores em memória + log estruturado periódico, sem introduzir Prometheus agora.

### Removidos no cleanup

- `WebhookInboxPolicyService` → vira `kind === 'ignore'` no `parse`.
- As 3 tabelas duplicadas de order-topics.
- `LISTING_UPDATED` (sem consumidor).
- Os 10 handlers do controller → 1 endpoint genérico.
- O `switch` do registry.
- O caminho EventEmitter-direto e o `WebhookService`.
- `extractOrderId` central (migra para o `parse` de cada adapter).

---

## 4. Modelo de dados, dedupe e ciclo de vida

### `eventId` — chave de dedupe estável

Cada adapter produz `eventId` a partir de campos **estáveis** do evento, nunca dos bytes do payload:

- ML: `mercadolivre:${topic}:${resource}` (ex.: `mercadolivre:orders_v2:/orders/123`)
- Shopee: `shopee:order:${ordersn}`
- Amazon: `amazon:${AmazonOrderId}` (do `Message` parseado)
- Fallback genérico: `${marketplace}:${topic}:${externalId}` quando há `externalId`.
- Último recurso explícito: hash do payload — apenas quando não há nenhum identificador estável, decidido pelo adapter (não default global).

`eventId` é `unique`. Inserção concorrente duplicada → erro 11000 → tratado como "já recebido" (idempotente).

### Schema `webhook_inbox` (reescrito)

```typescript
{
  marketplace: string;        // indexed
  topic: string;
  kind: 'order' | 'order_pack' | 'question' | 'unparseable';
  eventId: string;            // unique
  externalId?: string;        // indexed
  resource?: string;
  payload: unknown;           // auditoria
  status: 'pending' | 'processing' | 'done' | 'failed' | 'dead';  // indexed
  attempts: number;
  maxAttempts: number;
  owner?: string;             // réplica que detém o lease
  leaseUntil?: Date;          // indexed — reaper reclama se vencido
  nextRetryAt?: Date;
  lastError?: string;
  receivedAt?: Date;
  processedAt?: Date;
  // + timestamps (createdAt/updatedAt)
}
// índices: { status:1, leaseUntil:1, nextRetryAt:1 }, { eventId:1 } unique
```

### Ciclo de vida

```
pending ──claim(owner, leaseUntil=now+T)──▶ processing ──ok──▶ done
   ▲                                            │
   ├──fail & attempts<max (backoff)─────────────┤
   │                                            └──fail & attempts≥max──▶ dead (DLQ lógica + métrica)
   │
   └──reaper: processing & leaseUntil<now────────────────────────────── (volta a pending)
```

`unparseable` entra direto como `dead` (não é reprocessável).

---

## 5. Observabilidade (DLQ/alerta)

Decisão bigtech: a camada de ingestão é **infra** e fala via métricas + logs estruturados, não disparando canais de domínio (WhatsApp). Alerta é responsabilidade do sistema de observabilidade (dashboard + threshold).

- `webhook_inbox_dead_total{marketplace,kind}` incrementado ao marcar `dead`.
- `logger.error` estruturado com `eventId, marketplace, kind, attempts, lastError`.
- **Não** acoplar webhook → subsistema de notificações.

---

## 6. Tratamento de erros (fail-closed end-to-end)

| Situação | Resposta HTTP | Inbox |
|----------|---------------|-------|
| Marketplace desconhecido | 404 | — |
| Assinatura inválida/ausente (quando exigida) | 401 | — |
| `parse()` lança (payload malformado) | **200** | grava `dead` / `kind:'unparseable'` (auditoria; não faz o marketplace reenviar lixo) |
| `kind: 'ignore'` | 200 | não persiste |
| Falha ao persistir no inbox | **500** | — (marketplace deve reenviar) |
| Erro transitório no dispatch (downstream fora) | n/a (já deu 200) | retry via inbox (backoff) |

Princípio: nunca devolver 5xx por payload que nunca vai parsear (evita retry infinito do marketplace); 5xx só quando o reenvio é a ação correta (falha de persistência).

---

## 7. Migração (expand/contract, zero perda)

Estilo bigtech: schema novo **retrocompatível na leitura**. Campos novos (`eventId`, `kind`, `owner`, `leaseUntil`) são opcionais; itens legados sem eles recebem fallback no claim/boot. Worker novo processa itens antigos e novos — sem janela de drain e sem drop. Drain explícito (deixar worker antigo terminar pendentes antes do switch) fica como plano B caso algum campo não possa ser inferido.

A coleção `webhook_inbox` é transitória (itens `done` em minutos) e hoje só tem ML em produção, então o risco é mínimo de qualquer forma.

---

## 8. Estratégia de testes

Segue convenção do projeto (Jest, `--runInBand` por causa de contenção do `mongodb-memory-server`; lógica pura sem deps de framework onde possível).

- **`parse()` de cada adapter** — unitário puro: payload exemplo → `NormalizedWebhook` esperado (inclui `eventId` estável e `kind:'ignore'`). 1 arquivo por adapter. É o maior risco de regressão.
- **`SignatureVerifier`** — HMAC válido/inválido, length mismatch (timing-safe), SNS, scheme `none`, **fail-closed quando falta segredo**.
- **`WebhookInboxWorker`** — claim atômico, lease/reaper (leaseUntil vencido → reclaim), backoff, transição para `dead`. `mongodb-memory-server` + `--runInBand`.
- **`WebhookDispatcher`** — `kind → comando` correto; mock EventEmitter; valida shape dos 3 comandos contra o esperado pelos listeners.
- **`WebhookAdapterRegistry`** — discovery registra todos; `get` desconhecido → undefined.
- Specs antigos (`webhook.service.spec`, `webhook-dispatcher.service.spec`, `webhook-inbox*.spec`, `webhook-signature.guard.spec`) → **reescritos**, não adaptados.

---

## 9. Estrutura de arquivos alvo

```
backend/src/webhook/
  webhook.module.ts
  webhook.controller.ts                 (1 endpoint genérico)
  ingress/
    webhook-ingress.service.ts
    webhook-ingress.guard.ts
    webhook-context.ts
  adapters/
    webhook-adapter.interface.ts        (interface + decorator + SignatureScheme + NormalizedWebhook)
    webhook-adapter.registry.ts         (Map via DiscoveryService)
    mercadolivre.adapter.ts
    shopee.adapter.ts
    amazon.adapter.ts
    magalu.adapter.ts
    b2w.adapter.ts
    viavarejo.adapter.ts
    yampi.adapter.ts
    olx.adapter.ts
    aliexpress.adapter.ts
    tiktokshop.adapter.ts
  crypto/
    signature-verifier.service.ts
  inbox/
    webhook-inbox.schema.ts
    webhook-inbox.service.ts
    webhook-inbox.worker.ts
  dispatch/
    webhook-dispatcher.service.ts
  events/
    webhook.events.ts                   (3 comandos; LISTING_UPDATED removido)
  observability/
    webhook-metrics.service.ts
```
(nomes finais ajustáveis no plano; o agrupamento por responsabilidade é o ponto.)
