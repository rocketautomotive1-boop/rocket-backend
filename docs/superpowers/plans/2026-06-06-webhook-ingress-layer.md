# Webhook Ingress Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reescrever `backend/src/webhook` como uma camada de ingress genérica, plug-in e durável — core sem conhecimento de marketplaces, crypto central fail-closed lendo segredos da tabela `marketplaces`, inbox universal com lease/reaper.

**Architecture:** Endpoint genérico → guard que resolve adapter + verifica assinatura (fail-closed) → ingress persiste no inbox (ACK 200) → worker com lease/reaper despacha por `kind` → 3 comandos de domínio preservados. Adapters auto-registrados via `DiscoveryService`. Segredos via `MarketplaceCredentialsService` extraído para módulo `@Global` (sem `forwardRef`).

**Tech Stack:** NestJS, Mongoose, `@nestjs/event-emitter`, `@nestjs/core` DiscoveryService, Zod, Jest + ts-jest (`--runInBand`), Node `crypto`.

**Spec:** `docs/superpowers/specs/2026-06-06-webhook-ingress-layer-design.md`

**Repo:** rodar tudo em `backend/` (repo próprio, branch `feat/multi-domain-db-connection`). Verificar cwd antes de cada commit: `git rev-parse --show-toplevel`.

---

## Contratos a preservar (NÃO alterar — fronteira a jusante)

Estes eventos são consumidos fora de `webhook/` e o shape deve permanecer idêntico:

```typescript
// emitido para order/listeners/order-webhook-command.listener.ts
ORDER_SYNC_REQUESTED:  { marketplace, externalOrderId, resource?, receivedAt, source: 'webhook' }
ORDER_PACK_SYNC_REQUESTED: { marketplace: 'mercadolivre', externalPackId, resource, receivedAt, source: 'webhook' }
// emitido para questions/questions.service.ts
QUESTION_INGEST_REQUESTED: { marketplace: 'mercadolivre', externalQuestionId, resource, receivedAt }
```

`LISTING_UPDATED` é removido (sem consumidor). `WEBHOOK_EVENTS.RECEIVED` (EventEmitter direto) é removido (inbox universal).

---

## File Structure (alvo)

```
backend/src/marketplace/credentials/
  marketplace-credentials.module.ts        (NOVO — @Global, enxuto)
  (service movido de auth/services/ para cá)

backend/src/webhook/
  webhook.module.ts                        (reescrito)
  webhook.controller.ts                    (1 endpoint genérico)
  ingress/
    webhook-context.ts                     (tipo imutável)
    webhook-ingress.guard.ts               (resolve adapter + verify, fail-closed)
    webhook-ingress.service.ts             (parse → inbox → ACK)
  adapters/
    webhook-adapter.interface.ts           (interface + decorator + tipos)
    webhook-adapter.registry.ts            (Map via DiscoveryService)
    <marketplace>.adapter.ts               (×10)
  crypto/
    signature-verifier.service.ts          (HMAC + SNS, lê creds da tabela)
  inbox/
    webhook-inbox.schema.ts
    webhook-inbox.service.ts
    webhook-inbox.worker.ts                (poll + lease + reaper)
  dispatch/
    webhook-dispatcher.service.ts          (switch por kind)
  events/
    webhook.events.ts                      (3 comandos; sem LISTING_UPDATED/RECEIVED)
  observability/
    webhook-metrics.service.ts
```

**Removidos no cleanup (deletar arquivos):**
`webhook.service.ts` (+spec), `services/*-webhook.service.ts` (10), `services/webhook-inbox-policy.service.ts` (+spec), `services/webhook-adapter.registry.ts` (antigo switch), `services/webhook-inbox.service.ts` (movido p/ inbox/), `guards/webhook-signature.guard.ts` (+spec, vira ingress.guard), `consumers/webhook-dispatcher.service.ts` (+spec, vira dispatch/), `consumers/webhook-inbox.worker.ts` (+spec, vira inbox/).

---

## FASE 0 — Extrair MarketplaceCredentialsService para módulo @Global

Pré-requisito para webhook usar credenciais sem `forwardRef`. Resolve a raiz do acoplamento (memória: avoid-forwardref-circular-deps).

### Task 0.1: Criar MarketplaceCredentialsModule @Global

**Files:**
- Create: `src/marketplace/credentials/marketplace-credentials.module.ts`
- Move: `src/marketplace/auth/services/marketplace-credentials.service.ts` → `src/marketplace/credentials/marketplace-credentials.service.ts`
- Move: `src/marketplace/auth/services/credentials-crypto.helper.ts` → `src/marketplace/credentials/credentials-crypto.helper.ts`
- Modify: `src/marketplace/auth/marketplace-auth.module.ts`

- [ ] **Step 1: Mover os arquivos (preservando git history)**

```bash
cd backend
git mv src/marketplace/auth/services/marketplace-credentials.service.ts src/marketplace/credentials/marketplace-credentials.service.ts
git mv src/marketplace/auth/services/credentials-crypto.helper.ts src/marketplace/credentials/credentials-crypto.helper.ts
```

- [ ] **Step 2: Corrigir o import do helper dentro do service movido**

Em `src/marketplace/credentials/marketplace-credentials.service.ts`, o import passa a ser local e o do schema sobe um nível:

```typescript
import { MarketplaceModel, MarketplaceDocument } from '../schemas/marketplace.schema';
import { encrypt, decrypt, isEncrypted } from './credentials-crypto.helper';
```

- [ ] **Step 3: Criar o módulo @Global**

```typescript
// src/marketplace/credentials/marketplace-credentials.module.ts
import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MarketplaceModel, MarketplaceSchema } from '../schemas/marketplace.schema';
import { MarketplaceCredentialsService } from './marketplace-credentials.service';

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MarketplaceModel.name, schema: MarketplaceSchema },
    ]),
  ],
  providers: [MarketplaceCredentialsService],
  exports: [MarketplaceCredentialsService],
})
export class MarketplaceCredentialsModule {}
```

- [ ] **Step 4: Remover o service do MarketplaceAuthModule (passa a vir do global)**

Em `src/marketplace/auth/marketplace-auth.module.ts`: remover `MarketplaceCredentialsService` de `providers` e `exports`, e remover seu import direto. Atualizar imports que referenciavam `./services/marketplace-credentials.service` para `../credentials/marketplace-credentials.service` nos arquivos que ainda importam por caminho (signer, token-broker, credentials.controller). Adicionar `MarketplaceCredentialsModule` aos imports do AppModule (Step 6).

- [ ] **Step 5: Corrigir imports nos consumidores existentes**

Arquivos que importam o service por caminho relativo (ajustar para `../../credentials/marketplace-credentials.service` conforme profundidade):
`src/marketplace/auth/services/marketplace-signer.service.ts`,
`src/marketplace/auth/services/marketplace-token-broker.service.ts`,
`src/marketplace/auth/controllers/marketplace-credentials.controller.ts`,
`src/marketplace/adapters/shopee/shopee-auth.adapter.ts`,
`src/marketplace/adapters/tiktok-shop/tiktok-shop-auth.adapter.ts`.

Verificar caminhos:
```bash
cd backend && grep -rn "marketplace-credentials.service\|credentials-crypto.helper" src --include=*.ts | grep -v "src/marketplace/credentials/"
```
Expected: cada hit ajustado para o novo caminho.

- [ ] **Step 6: Registrar o módulo global no AppModule**

Em `src/app.module.ts`, adicionar aos imports:
```typescript
import { MarketplaceCredentialsModule } from './marketplace/credentials/marketplace-credentials.module';
// ...
imports: [ /* ... */ MarketplaceCredentialsModule, /* ... */ ]
```

- [ ] **Step 7: Build + testes existentes**

Run: `cd backend && npm run build && npm test -- --runInBand marketplace`
Expected: build OK; specs de marketplace (token-broker, signer, credentials) PASS sem mudança de comportamento.

- [ ] **Step 8: Verificar que nenhum forwardRef foi adicionado**

```bash
cd backend && git diff --stat && grep -rn "forwardRef" src/marketplace/credentials src/webhook 2>/dev/null
```
Expected: zero `forwardRef` nos diretórios novos.

- [ ] **Step 9: Commit**

```bash
cd backend && git add -A && git commit -m "refactor(marketplace): extrai MarketplaceCredentialsService para módulo @Global

Desacopla credenciais do MarketplaceAuthModule (que carrega forwardRef).
Service transversal vira @Global, reutilizável sem ciclo. Pré-requisito
para a camada de webhook ler segredos da tabela sem forwardRef.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## FASE 1 — Tipos e contrato do adapter (foundation)

### Task 1.1: Tipos canônicos e interface do adapter

**Files:**
- Create: `src/webhook/adapters/webhook-adapter.interface.ts`
- Test: `src/webhook/adapters/webhook-adapter.interface.spec.ts`

- [ ] **Step 1: Escrever o teste do decorator (metadata)**

```typescript
// webhook-adapter.interface.spec.ts
import 'reflect-metadata';
import {
  RegisterWebhookAdapter,
  WEBHOOK_ADAPTER_METADATA,
} from './webhook-adapter.interface';

describe('RegisterWebhookAdapter', () => {
  it('grava o nome do marketplace na metadata da classe', () => {
    @RegisterWebhookAdapter('shopee')
    class FakeAdapter {}
    const meta = Reflect.getMetadata(WEBHOOK_ADAPTER_METADATA, FakeAdapter);
    expect(meta).toBe('shopee');
  });
});
```

- [ ] **Step 2: Rodar — deve falhar**

Run: `cd backend && npm test -- --runInBand webhook-adapter.interface`
Expected: FAIL ("Cannot find module './webhook-adapter.interface'").

- [ ] **Step 3: Implementar os tipos + decorator**

```typescript
// webhook-adapter.interface.ts
import { SetMetadata } from '@nestjs/common';

export const WEBHOOK_ADAPTER_METADATA = 'webhook:adapter:marketplace';

export type WebhookKind = 'order' | 'order_pack' | 'question' | 'ignore';

export interface WebhookContext {
  readonly marketplace: string;
  readonly topic: string;
  readonly headers: Record<string, string | undefined>;
  readonly rawBody?: Buffer;
  readonly payload: any;
}

export interface NormalizedWebhook {
  kind: WebhookKind;
  eventId: string;
  externalId?: string;
  resource?: string;
  raw: unknown;
}

export type SignatureScheme =
  | { type: 'none' }
  | {
      type: 'hmac-sha256';
      header: string;
      secretKey: string; // chave em marketplaces.credentials
      baseString: 'rawBody' | ((ctx: WebhookContext) => string);
    }
  | { type: 'aws-sns' };

export interface WebhookAdapter {
  readonly marketplace: string;
  readonly signatureScheme: SignatureScheme;
  parse(ctx: WebhookContext): NormalizedWebhook;
}

export const RegisterWebhookAdapter = (marketplace: string) =>
  SetMetadata(WEBHOOK_ADAPTER_METADATA, marketplace);
```

- [ ] **Step 4: Rodar — deve passar**

Run: `cd backend && npm test -- --runInBand webhook-adapter.interface`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd backend && git add src/webhook/adapters/webhook-adapter.interface.ts src/webhook/adapters/webhook-adapter.interface.spec.ts && git commit -m "feat(webhook): contrato canônico do adapter (interface + decorator + tipos)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 1.2: Eventos de domínio (limpos)

**Files:**
- Modify: `src/webhook/events/webhook.events.ts`

- [ ] **Step 1: Reescrever o arquivo de eventos (remover RECEIVED e LISTING_UPDATED)**

```typescript
// src/webhook/events/webhook.events.ts
export const WEBHOOK_DOMAIN_COMMANDS = {
  ORDER_SYNC_REQUESTED: 'order.sync_requested',
  ORDER_PACK_SYNC_REQUESTED: 'order.pack_sync_requested',
  QUESTION_INGEST_REQUESTED: 'question.ingest_requested',
} as const;

export interface OrderSyncRequestedCommand {
  marketplace: string;
  externalOrderId: string;
  resource?: string | null;
  receivedAt: Date;
  source: 'webhook';
}

export interface OrderPackSyncRequestedCommand {
  marketplace: 'mercadolivre';
  externalPackId: string;
  resource: string;
  receivedAt: Date;
  source: 'webhook';
}

export interface QuestionIngestRequestedCommand {
  marketplace: 'mercadolivre';
  externalQuestionId: string;
  resource: string;
  receivedAt: Date;
}
```

- [ ] **Step 2: Verificar que consumidores externos ainda compilam**

```bash
cd backend && npm run build
```
Expected: OK. (Consumidores importam `WEBHOOK_DOMAIN_COMMANDS.ORDER_*`/`QUESTION_*` e os tipos `*Command` — todos mantidos. `LISTING_UPDATED`/`MarketplaceTag`/`WebhookReceivedEvent`/`ListingUpdatedCommand` removidos não têm consumidor externo — confirmado por grep na fase de design.)

- [ ] **Step 3: Commit**

```bash
cd backend && git add src/webhook/events/webhook.events.ts && git commit -m "refactor(webhook): remove eventos mortos (RECEIVED, LISTING_UPDATED)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## FASE 2 — SignatureVerifier (crypto central, fail-closed)

### Task 2.1: SignatureVerifier — HMAC

**Files:**
- Create: `src/webhook/crypto/signature-verifier.service.ts`
- Test: `src/webhook/crypto/signature-verifier.service.spec.ts`

- [ ] **Step 1: Teste — HMAC válido, inválido, length mismatch, fail-closed**

```typescript
// signature-verifier.service.spec.ts
import * as crypto from 'crypto';
import { SignatureVerifier } from './signature-verifier.service';
import { WebhookContext } from '../adapters/webhook-adapter.interface';

const makeCtx = (over: Partial<WebhookContext> = {}): WebhookContext => ({
  marketplace: 'mercadolivre',
  topic: 'orders_v2',
  headers: {},
  rawBody: Buffer.from('{"a":1}'),
  payload: { a: 1 },
  ...over,
});

const sign = (secret: string, body: string) =>
  crypto.createHmac('sha256', secret).update(body).digest('hex');

describe('SignatureVerifier (hmac-sha256)', () => {
  const makeSut = (secret?: string) => {
    const credentials = { get: jest.fn().mockResolvedValue(secret) };
    return { sut: new SignatureVerifier(credentials as any), credentials };
  };
  const scheme = {
    type: 'hmac-sha256' as const,
    header: 'x-signature',
    secretKey: 'webhookSecret',
    baseString: 'rawBody' as const,
  };

  it('aceita assinatura válida', async () => {
    const { sut } = makeSut('s3cr3t');
    const body = '{"a":1}';
    const ctx = makeCtx({ rawBody: Buffer.from(body), headers: { 'x-signature': sign('s3cr3t', body) } });
    await expect(sut.verify(scheme, ctx)).resolves.toBe(true);
  });

  it('rejeita assinatura inválida (mesmo tamanho)', async () => {
    const { sut } = makeSut('s3cr3t');
    const body = '{"a":1}';
    const wrong = sign('outro', body);
    const ctx = makeCtx({ rawBody: Buffer.from(body), headers: { 'x-signature': wrong } });
    await expect(sut.verify(scheme, ctx)).resolves.toBe(false);
  });

  it('rejeita quando o header tem tamanho diferente (sem lançar)', async () => {
    const { sut } = makeSut('s3cr3t');
    const ctx = makeCtx({ headers: { 'x-signature': 'curto' } });
    await expect(sut.verify(scheme, ctx)).resolves.toBe(false);
  });

  it('FAIL-CLOSED: rejeita quando o segredo não está configurado', async () => {
    const { sut } = makeSut(undefined);
    const ctx = makeCtx({ headers: { 'x-signature': 'qualquer' } });
    await expect(sut.verify(scheme, ctx)).resolves.toBe(false);
  });

  it('rejeita quando o header está ausente', async () => {
    const { sut } = makeSut('s3cr3t');
    await expect(sut.verify(scheme, makeCtx())).resolves.toBe(false);
  });

  it('scheme none sempre aceita', async () => {
    const { sut } = makeSut(undefined);
    await expect(sut.verify({ type: 'none' }, makeCtx())).resolves.toBe(true);
  });
});
```

- [ ] **Step 2: Rodar — deve falhar**

Run: `cd backend && npm test -- --runInBand signature-verifier`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar (HMAC + none; SNS na Task 2.2)**

```typescript
// signature-verifier.service.ts
import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { MarketplaceCredentialsService } from '../../marketplace/credentials/marketplace-credentials.service';
import { SignatureScheme, WebhookContext } from '../adapters/webhook-adapter.interface';

@Injectable()
export class SignatureVerifier {
  private readonly logger = new Logger(SignatureVerifier.name);

  constructor(private readonly credentials: MarketplaceCredentialsService) {}

  async verify(scheme: SignatureScheme, ctx: WebhookContext): Promise<boolean> {
    switch (scheme.type) {
      case 'none':
        return true;
      case 'hmac-sha256':
        return this.verifyHmac(scheme, ctx);
      case 'aws-sns':
        return this.verifySns(ctx);
    }
  }

  private async verifyHmac(
    scheme: Extract<SignatureScheme, { type: 'hmac-sha256' }>,
    ctx: WebhookContext,
  ): Promise<boolean> {
    const provided = ctx.headers[scheme.header.toLowerCase()];
    if (!provided) {
      this.logger.warn(`[Sig] header ausente (${scheme.header}) marketplace=${ctx.marketplace}`);
      return false;
    }

    const secret = await this.credentials.get(ctx.marketplace, scheme.secretKey);
    if (!secret) {
      // FAIL-CLOSED: sem segredo configurado, rejeita
      this.logger.error(
        `[Sig] segredo '${scheme.secretKey}' ausente para ${ctx.marketplace} — rejeitando (fail-closed)`,
      );
      return false;
    }

    const base =
      scheme.baseString === 'rawBody'
        ? ctx.rawBody ?? Buffer.from(JSON.stringify(ctx.payload))
        : Buffer.from(scheme.baseString(ctx));

    const expected = crypto.createHmac('sha256', secret).update(base).digest('hex');
    return this.safeEqual(expected, provided);
  }

  private safeEqual(a: string, b: string): boolean {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) return false; // timingSafeEqual lança se length difere
    return crypto.timingSafeEqual(ba, bb);
  }

  // implementado na Task 2.2
  private async verifySns(_ctx: WebhookContext): Promise<boolean> {
    return false;
  }
}
```

- [ ] **Step 4: Rodar — deve passar**

Run: `cd backend && npm test -- --runInBand signature-verifier`
Expected: PASS (todos os casos HMAC + none).

- [ ] **Step 5: Commit**

```bash
cd backend && git add src/webhook/crypto/ && git commit -m "feat(webhook): SignatureVerifier central HMAC fail-closed (lê creds da tabela)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 2.2: SignatureVerifier — AWS SNS

**Files:**
- Modify: `src/webhook/crypto/signature-verifier.service.ts`
- Test: `src/webhook/crypto/signature-verifier.service.spec.ts` (adicionar describe)

- [ ] **Step 1: Teste SNS (SubscriptionConfirmation e assinatura)**

Adicionar ao spec:

```typescript
describe('SignatureVerifier (aws-sns)', () => {
  const makeSut = () => new SignatureVerifier({ get: jest.fn() } as any);

  it('rejeita mensagem SNS sem assinatura', async () => {
    const sut = makeSut();
    const ctx = makeCtx({ marketplace: 'amazon', payload: { Type: 'Notification' } });
    await expect(sut.verify({ type: 'aws-sns' }, ctx)).resolves.toBe(false);
  });

  it('aceita SNS com assinatura válida (chave de teste)', async () => {
    // gerar par RSA de teste, assinar o canonical string, expor cert via mock de fetch
    // (implementação completa no Step 3; teste valida o caminho feliz com cert injetado)
    const sut = makeSut();
    const { canonical, signature, certUrl, certPem, payload } = buildSignedSnsFixture();
    (sut as any).fetchCertificate = jest.fn().mockResolvedValue(certPem);
    const ctx = makeCtx({ marketplace: 'amazon', payload });
    await expect(sut.verify({ type: 'aws-sns' }, ctx)).resolves.toBe(true);
    void canonical; void signature; void certUrl;
  });
});

// helper no topo do arquivo de teste
function buildSignedSnsFixture() {
  const { generateKeyPairSync } = require('crypto');
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const certPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const payload: any = {
    Type: 'Notification',
    MessageId: 'm1',
    TopicArn: 'arn:test',
    Message: '{"AmazonOrderId":"123"}',
    Timestamp: '2026-06-06T00:00:00.000Z',
    SignatureVersion: '1',
    SigningCertURL: 'https://sns.us-east-1.amazonaws.com/cert.pem',
    Subject: 'x',
  };
  const canonical =
    `Message\n${payload.Message}\n` +
    `MessageId\n${payload.MessageId}\n` +
    `Subject\n${payload.Subject}\n` +
    `Timestamp\n${payload.Timestamp}\n` +
    `TopicArn\n${payload.TopicArn}\n` +
    `Type\n${payload.Type}\n`;
  const signer = require('crypto').createSign('RSA-SHA1');
  signer.update(canonical, 'utf8');
  payload.Signature = signer.sign(privateKey, 'base64');
  return { canonical, signature: payload.Signature, certUrl: payload.SigningCertURL, certPem, payload };
}
```

- [ ] **Step 2: Rodar — deve falhar**

Run: `cd backend && npm test -- --runInBand signature-verifier`
Expected: FAIL (verifySns retorna false hardcoded).

- [ ] **Step 3: Implementar verifySns**

Substituir o stub `verifySns`:

```typescript
import axios from 'axios';

private certCache = new Map<string, string>();

private async fetchCertificate(url: string): Promise<string> {
  const cached = this.certCache.get(url);
  if (cached) return cached;
  const { data } = await axios.get<string>(url, { responseType: 'text' });
  this.certCache.set(url, data);
  return data;
}

private buildSnsCanonical(p: any): string {
  const keys =
    p.Type === 'Notification'
      ? ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type']
      : ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'];
  let out = '';
  for (const k of keys) {
    if (p[k] === undefined || p[k] === null) continue;
    out += `${k}\n${p[k]}\n`;
  }
  return out;
}

private async verifySns(ctx: WebhookContext): Promise<boolean> {
  const p = ctx.payload;
  if (!p?.Signature || !p?.SigningCertURL) return false;

  // SigningCertURL deve ser do domínio sns.*.amazonaws.com (fail-closed contra cert forjado)
  let host: string;
  try {
    host = new URL(p.SigningCertURL).hostname;
  } catch {
    return false;
  }
  if (!/^sns\.[a-z0-9-]+\.amazonaws\.com$/.test(host)) {
    this.logger.error(`[Sig] SigningCertURL host inválido: ${host}`);
    return false;
  }

  try {
    const certPem = await this.fetchCertificate(p.SigningCertURL);
    const canonical = this.buildSnsCanonical(p);
    const verifier = crypto.createVerify('RSA-SHA1');
    verifier.update(canonical, 'utf8');
    return verifier.verify(certPem, p.Signature, 'base64');
  } catch (err) {
    this.logger.error(`[Sig] erro verificando SNS: ${(err as Error).message}`);
    return false;
  }
}
```

- [ ] **Step 4: Rodar — deve passar**

Run: `cd backend && npm test -- --runInBand signature-verifier`
Expected: PASS (HMAC + none + SNS).

- [ ] **Step 5: Commit**

```bash
cd backend && git add src/webhook/crypto/ && git commit -m "feat(webhook): verificação de assinatura AWS SNS X.509 (fail-closed por host)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## FASE 3 — Adapters (×10)

Cada adapter implementa `WebhookAdapter` (interface da Task 1.1). Detalho ML e Shopee completos; os outros 8 seguem o template + a tabela de dados ao final da fase. Cada adapter tem seu spec de `parse()`.

### Task 3.1: MercadoLivreAdapter

**Files:**
- Create: `src/webhook/adapters/mercadolivre.adapter.ts`
- Test: `src/webhook/adapters/mercadolivre.adapter.spec.ts`

- [ ] **Step 1: Teste de parse (order, pack, question, ignore)**

```typescript
// mercadolivre.adapter.spec.ts
import { MercadoLivreAdapter } from './mercadolivre.adapter';
import { WebhookContext } from './webhook-adapter.interface';

const ctx = (topic: string, payload: any): WebhookContext => ({
  marketplace: 'mercadolivre', topic, headers: {}, payload, rawBody: Buffer.from(JSON.stringify(payload)),
});

describe('MercadoLivreAdapter.parse', () => {
  const sut = new MercadoLivreAdapter();

  it('order: resource /orders/123 → kind order, externalId 123', () => {
    const n = sut.parse(ctx('orders_v2', { resource: '/orders/123', user_id: 9 }));
    expect(n.kind).toBe('order');
    expect(n.externalId).toBe('123');
    expect(n.eventId).toBe('mercadolivre:orders_v2:/orders/123');
  });

  it('pack: resource /packs/55 → kind order_pack, externalId 55', () => {
    const n = sut.parse(ctx('orders_v2', { resource: '/packs/55' }));
    expect(n.kind).toBe('order_pack');
    expect(n.externalId).toBe('55');
  });

  it('question: topic questions → kind question', () => {
    const n = sut.parse(ctx('questions', { resource: '/questions/77' }));
    expect(n.kind).toBe('question');
    expect(n.externalId).toBe('77');
  });

  it('topic irrelevante → kind ignore', () => {
    const n = sut.parse(ctx('items', { resource: '/items/MLB1' }));
    expect(n.kind).toBe('ignore');
  });

  it('declara scheme hmac com secretKey webhookSecret', () => {
    expect(sut.signatureScheme).toEqual({
      type: 'hmac-sha256', header: 'x-signature', secretKey: 'webhookSecret', baseString: 'rawBody',
    });
  });
});
```

- [ ] **Step 2: Rodar — deve falhar**

Run: `cd backend && npm test -- --runInBand mercadolivre.adapter`
Expected: FAIL.

- [ ] **Step 3: Implementar**

```typescript
// mercadolivre.adapter.ts
import { Injectable } from '@nestjs/common';
import {
  NormalizedWebhook, RegisterWebhookAdapter, SignatureScheme, WebhookAdapter, WebhookContext,
} from './webhook-adapter.interface';

const lastSeg = (r: string) => r.split('/').filter(Boolean).pop() ?? '';

@Injectable()
@RegisterWebhookAdapter('mercadolivre')
export class MercadoLivreAdapter implements WebhookAdapter {
  readonly marketplace = 'mercadolivre';
  readonly signatureScheme: SignatureScheme = {
    type: 'hmac-sha256', header: 'x-signature', secretKey: 'webhookSecret', baseString: 'rawBody',
  };

  parse(ctx: WebhookContext): NormalizedWebhook {
    const topic = String(ctx.topic || '').toLowerCase();
    const resource = String(ctx.payload?.resource || '');

    if (resource.startsWith('/packs/')) {
      return { kind: 'order_pack', eventId: `mercadolivre:packs:${resource}`, externalId: lastSeg(resource), resource, raw: ctx.payload };
    }
    if (topic === 'orders_v2' || resource.startsWith('/orders/')) {
      return { kind: 'order', eventId: `mercadolivre:orders_v2:${resource}`, externalId: lastSeg(resource), resource, raw: ctx.payload };
    }
    if (topic === 'questions' || resource.startsWith('/questions/')) {
      return { kind: 'question', eventId: `mercadolivre:questions:${resource}`, externalId: lastSeg(resource), resource, raw: ctx.payload };
    }
    return { kind: 'ignore', eventId: `mercadolivre:${topic}:${resource}`, resource, raw: ctx.payload };
  }
}
```

- [ ] **Step 4: Rodar — deve passar**

Run: `cd backend && npm test -- --runInBand mercadolivre.adapter`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd backend && git add src/webhook/adapters/mercadolivre.adapter.* && git commit -m "feat(webhook): MercadoLivreAdapter (parse order/pack/question)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 3.2: ShopeeAdapter (segredo por conta)

**Files:**
- Create: `src/webhook/adapters/shopee.adapter.ts`
- Test: `src/webhook/adapters/shopee.adapter.spec.ts`

- [ ] **Step 1: Teste de parse**

```typescript
// shopee.adapter.spec.ts
import { ShopeeAdapter } from './shopee.adapter';
import { WebhookContext } from './webhook-adapter.interface';

const ctx = (topic: string, payload: any): WebhookContext => ({
  marketplace: 'shopee', topic, headers: {}, payload, rawBody: Buffer.from(JSON.stringify(payload)),
});

describe('ShopeeAdapter.parse', () => {
  const sut = new ShopeeAdapter();

  it('order → kind order, externalId ordersn', () => {
    const n = sut.parse(ctx('order', { data: { ordersn: 'SN123' }, partner_id: 7 }));
    expect(n.kind).toBe('order');
    expect(n.externalId).toBe('SN123');
    expect(n.eventId).toBe('shopee:order:SN123');
  });

  it('order_sn alternativo também resolve', () => {
    const n = sut.parse(ctx('order', { data: { order_sn: 'SN9' } }));
    expect(n.externalId).toBe('SN9');
  });

  it('topic não-order → ignore', () => {
    expect(sut.parse(ctx('item', {})).kind).toBe('ignore');
  });

  it('scheme hmac com baseString partner_id+body', () => {
    expect(sut.signatureScheme.type).toBe('hmac-sha256');
  });
});
```

- [ ] **Step 2: Rodar — deve falhar**

Run: `cd backend && npm test -- --runInBand shopee.adapter`
Expected: FAIL.

- [ ] **Step 3: Implementar (baseString custom: partnerId+body)**

```typescript
// shopee.adapter.ts
import { Injectable } from '@nestjs/common';
import {
  NormalizedWebhook, RegisterWebhookAdapter, SignatureScheme, WebhookAdapter, WebhookContext,
} from './webhook-adapter.interface';

@Injectable()
@RegisterWebhookAdapter('shopee')
export class ShopeeAdapter implements WebhookAdapter {
  readonly marketplace = 'shopee';
  readonly signatureScheme: SignatureScheme = {
    type: 'hmac-sha256',
    header: 'x-shopee-signature',
    secretKey: 'partnerKey',
    baseString: (ctx) => `${ctx.payload?.partner_id ?? ''}${ctx.rawBody?.toString('utf8') ?? JSON.stringify(ctx.payload)}`,
  };

  parse(ctx: WebhookContext): NormalizedWebhook {
    const topic = String(ctx.topic || '').toLowerCase();
    if (topic !== 'order') {
      return { kind: 'ignore', eventId: `shopee:${topic}`, raw: ctx.payload };
    }
    const sn = ctx.payload?.data?.ordersn || ctx.payload?.data?.order_sn || '';
    return { kind: 'order', eventId: `shopee:order:${sn}`, externalId: String(sn), raw: ctx.payload };
  }
}
```

- [ ] **Step 4: Rodar — deve passar**

Run: `cd backend && npm test -- --runInBand shopee.adapter`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd backend && git add src/webhook/adapters/shopee.adapter.* && git commit -m "feat(webhook): ShopeeAdapter (parse order, baseString partnerId+body)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 3.3: Adapters restantes (amazon, magalu, b2w, viavarejo, yampi, olx, aliexpress, tiktokshop)

Para cada um: criar `<mkt>.adapter.ts` + `<mkt>.adapter.spec.ts` seguindo o template do ShopeeAdapter, usando a tabela abaixo. Um commit por adapter.

**Template do spec** (substituir `MKT`, `topicOrder`, `payload`, `expectedId`, `eventId`):
```typescript
import { XxxAdapter } from './xxx.adapter';
import { WebhookContext } from './webhook-adapter.interface';
const ctx = (topic: string, payload: any): WebhookContext => ({
  marketplace: 'MKT', topic, headers: {}, payload, rawBody: Buffer.from(JSON.stringify(payload)),
});
describe('XxxAdapter.parse', () => {
  const sut = new XxxAdapter();
  it('order → kind order com externalId', () => {
    const n = sut.parse(ctx('topicOrder', /* payload */));
    expect(n.kind).toBe('order');
    expect(n.externalId).toBe('expectedId');
  });
  it('topic irrelevante → ignore', () => {
    expect(sut.parse(ctx('zzz', {})).kind).toBe('ignore');
  });
});
```

**Tabela de dados por adapter** (kind sempre `order` quando o topic casa; senão `ignore`):

| Adapter | decorator | header de assinatura | secretKey | scheme | topic de order | externalId (do payload) | eventId |
|---|---|---|---|---|---|---|---|
| `AmazonAdapter` | `amazon` | (SNS) | — | `aws-sns` | `order-notification` | `JSON.parse(payload.Message).AmazonOrderId` ?? `payload.AmazonOrderId` | `amazon:order:${externalId}` |
| `MagaluAdapter` | `magalu` | `x-magalu-signature` | `webhookSecret` | hmac/rawBody | `orders` | `payload.data?.id` ?? `payload.order_id` | `magalu:orders:${externalId}` |
| `B2WAdapter` | `b2w` | `x-hub-signature` | `webhookSecret` | hmac/rawBody | `orders` | `payload.data?.id` ?? `payload.order?.id` | `b2w:orders:${externalId}` |
| `ViaVarejoAdapter` | `viavarejo` | `x-viavarejo-signature` | `webhookSecret` | hmac/rawBody | `order.created/updated/shipped/delivered/cancelled` | `payload.data?.id` | `viavarejo:${topic}:${externalId}` |
| `YampiAdapter` | `yampi` | `x-yampi-hmac-sha256` | `webhookSecret` | hmac/rawBody | `order` | `payload.data?.id` ?? `payload.resource?.id` | `yampi:order:${externalId}` |
| `OLXAdapter` | `olx` | — | — | `none` | (nenhum order hoje) | — | `olx:${topic}:${resource}` |
| `AliExpressAdapter` | `aliexpress` | `x-acs-signature` | `webhookSecret` | hmac/rawBody | `trade` | `payload.data?.order_id` | `aliexpress:trade:${externalId}` |
| `TikTokShopAdapter` | `tiktokshop` | `x-tts-signature` | `webhookSecret` | hmac/rawBody | (sem order mapeado hoje → ignore) | — | `tiktokshop:${topic}` |

Notas:
- **Amazon `SubscriptionConfirmation`**: quando `payload.Type === 'SubscriptionConfirmation'`, o adapter retorna `kind: 'ignore'` (a confirmação da URL é tratada como efeito colateral no guard/ingress — ver Task 5.2). O `parse` nunca lança nesse caso.
- **OLX/TikTok** hoje não geram comando de domínio → sempre `kind: 'ignore'`. Mantidos como adapters (escopo: manter 10 marketplaces) prontos para quando houver topic de order.
- Todo `parse` deve ser defensivo: campo ausente → `kind: 'ignore'` em vez de lançar (lançar só em payload estruturalmente impossível de ler).

- [ ] **Step 1-8: Para cada um dos 8 adapters** — escrever spec (template), rodar (FAIL), implementar (template Shopee + linha da tabela), rodar (PASS), commit individual `feat(webhook): <Mkt>Adapter (parse)`.

Run de verificação ao fim:
```bash
cd backend && npm test -- --runInBand src/webhook/adapters
```
Expected: 10 specs de adapter PASS.

---

## FASE 4 — Registry via DiscoveryService

### Task 4.1: WebhookAdapterRegistry

**Files:**
- Create: `src/webhook/adapters/webhook-adapter.registry.ts`
- Test: `src/webhook/adapters/webhook-adapter.registry.spec.ts`

- [ ] **Step 1: Teste — registra por metadata, get/has**

```typescript
// webhook-adapter.registry.spec.ts
import { WebhookAdapterRegistry } from './webhook-adapter.registry';
import { RegisterWebhookAdapter, WEBHOOK_ADAPTER_METADATA } from './webhook-adapter.interface';

@RegisterWebhookAdapter('mercadolivre')
class MlFake { marketplace = 'mercadolivre'; signatureScheme = { type: 'none' as const }; parse() { return {} as any; } }

describe('WebhookAdapterRegistry', () => {
  const makeSut = (instances: any[]) => {
    const discovery = {
      getProviders: () => instances.map((instance) => ({ instance, metatype: instance?.constructor })),
    };
    const reflector = {
      get: (_k: string, t: any) => Reflect.getMetadata(WEBHOOK_ADAPTER_METADATA, t),
    };
    return new WebhookAdapterRegistry(discovery as any, reflector as any);
  };

  it('indexa adapters decorados e resolve por nome', () => {
    const ml = new MlFake();
    const sut = makeSut([ml, {}, null]);
    sut.onModuleInit();
    expect(sut.has('mercadolivre')).toBe(true);
    expect(sut.get('mercadolivre')).toBe(ml);
    expect(sut.get('inexistente')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Rodar — deve falhar**

Run: `cd backend && npm test -- --runInBand webhook-adapter.registry`
Expected: FAIL.

- [ ] **Step 3: Implementar com DiscoveryService**

```typescript
// webhook-adapter.registry.ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { DiscoveryService, Reflector } from '@nestjs/core';
import { WebhookAdapter, WEBHOOK_ADAPTER_METADATA } from './webhook-adapter.interface';

@Injectable()
export class WebhookAdapterRegistry implements OnModuleInit {
  private readonly adapters = new Map<string, WebhookAdapter>();

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly reflector: Reflector,
  ) {}

  onModuleInit(): void {
    for (const wrapper of this.discovery.getProviders()) {
      const instance: any = wrapper.instance;
      if (!instance || !instance.constructor) continue;
      const marketplace = this.reflector.get<string>(WEBHOOK_ADAPTER_METADATA, instance.constructor);
      if (marketplace) this.adapters.set(marketplace, instance as WebhookAdapter);
    }
  }

  get(marketplace: string): WebhookAdapter | undefined {
    return this.adapters.get(marketplace);
  }
  has(marketplace: string): boolean {
    return this.adapters.has(marketplace);
  }
  list(): string[] {
    return [...this.adapters.keys()];
  }
}
```

- [ ] **Step 4: Rodar — deve passar**

Run: `cd backend && npm test -- --runInBand webhook-adapter.registry`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd backend && git add src/webhook/adapters/webhook-adapter.registry.* && git commit -m "feat(webhook): registry auto-discovery (sem switch)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## FASE 5 — Inbox (schema, service, worker com lease/reaper)

### Task 5.1: Schema do inbox

**Files:**
- Create: `src/webhook/inbox/webhook-inbox.schema.ts`

- [ ] **Step 1: Escrever o schema**

```typescript
// webhook-inbox.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type WebhookInboxDocument = HydratedDocument<WebhookInboxModel>;
export type WebhookInboxStatus = 'pending' | 'processing' | 'done' | 'failed' | 'dead';
export type WebhookInboxKind = 'order' | 'order_pack' | 'question' | 'unparseable';

@Schema({ collection: 'webhook_inbox', timestamps: true })
export class WebhookInboxModel {
  @Prop({ required: true, index: true }) marketplace: string;
  @Prop({ required: true }) topic: string;
  @Prop({ required: true }) kind: WebhookInboxKind;
  @Prop({ required: true, unique: true }) eventId: string;
  @Prop({ index: true }) externalId?: string;
  @Prop() resource?: string;
  @Prop({ type: Object, required: true }) payload: any;
  @Prop({ default: 'pending', index: true }) status: WebhookInboxStatus;
  @Prop({ default: 0 }) attempts: number;
  @Prop({ default: 8 }) maxAttempts: number;
  @Prop() owner?: string;
  @Prop({ index: true }) leaseUntil?: Date;
  @Prop({ index: true }) nextRetryAt?: Date;
  @Prop() receivedAt?: Date;
  @Prop() processedAt?: Date;
  @Prop() lastError?: string;
}

export const WebhookInboxSchema = SchemaFactory.createForClass(WebhookInboxModel);
WebhookInboxSchema.index({ status: 1, leaseUntil: 1, nextRetryAt: 1, createdAt: 1 });
```

- [ ] **Step 2: Build**

Run: `cd backend && npm run build`
Expected: OK.

> **Migração de dados (expand/contract, zero perda):** a coleção `webhook_inbox` é reusada. O schema antigo tinha `dedupeKey` (unique) em vez de `eventId`. Na primeira subida com o schema novo, o índice antigo `dedupeKey_1` ficará órfão e o novo `eventId_1` será criado por `autoIndex`. Como a coleção é transitória (itens `done`/`failed` somem em minutos) e hoje só tem ML em produção, **não há migração de dados** — itens legados em voo (sem `eventId`/`kind`) são raros; se algum existir em `pending`, o worker novo o ignora (não casa o filtro) e o marketplace reenvia. Operacionalmente: dropar o índice órfão `dedupeKey_1` manualmente após o deploy (`db.webhook_inbox.dropIndex('dedupeKey_1')`) ou deixar `autoIndex` reconciliar. Sem janela de drain necessária.

- [ ] **Step 3: Commit**

```bash
cd backend && git add src/webhook/inbox/webhook-inbox.schema.ts && git commit -m "feat(webhook): schema inbox universal (eventId unique, lease, kind)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 5.2: WebhookInboxService (append idempotente)

**Files:**
- Create: `src/webhook/inbox/webhook-inbox.service.ts`
- Test: `src/webhook/inbox/webhook-inbox.service.spec.ts`

- [ ] **Step 1: Teste — append novo e duplicado (11000)**

```typescript
// webhook-inbox.service.spec.ts
import { WebhookInboxService } from './webhook-inbox.service';
import { NormalizedWebhook } from '../adapters/webhook-adapter.interface';

const normalized: NormalizedWebhook = {
  kind: 'order', eventId: 'mercadolivre:orders_v2:/orders/1', externalId: '1', resource: '/orders/1', raw: { resource: '/orders/1' },
};

describe('WebhookInboxService.append', () => {
  const makeSut = (createImpl: any) => {
    const model: any = { create: jest.fn(createImpl), findOne: jest.fn() };
    return { sut: new WebhookInboxService(model), model };
  };

  it('cria registro novo (isNew true)', async () => {
    const created = { _id: 'x', eventId: normalized.eventId };
    const { sut } = makeSut(() => Promise.resolve(created));
    const r = await sut.append('mercadolivre', 'orders_v2', normalized);
    expect(r.isNew).toBe(true);
    expect(r.record).toBe(created);
  });

  it('duplicado (11000) → isNew false, retorna existente', async () => {
    const existing = { _id: 'y', eventId: normalized.eventId };
    const model: any = {
      create: jest.fn().mockRejectedValue({ code: 11000 }),
      findOne: jest.fn().mockReturnValue({ exec: () => Promise.resolve(existing) }),
    };
    const sut = new WebhookInboxService(model);
    const r = await sut.append('mercadolivre', 'orders_v2', normalized);
    expect(r.isNew).toBe(false);
    expect(r.record).toBe(existing);
  });
});
```

- [ ] **Step 2: Rodar — deve falhar**

Run: `cd backend && npm test -- --runInBand webhook-inbox.service`
Expected: FAIL.

- [ ] **Step 3: Implementar**

```typescript
// webhook-inbox.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { WebhookInboxDocument, WebhookInboxModel } from './webhook-inbox.schema';
import { NormalizedWebhook } from '../adapters/webhook-adapter.interface';

@Injectable()
export class WebhookInboxService {
  private readonly logger = new Logger(WebhookInboxService.name);

  constructor(
    @InjectModel(WebhookInboxModel.name)
    private readonly model: Model<WebhookInboxDocument>,
  ) {}

  async append(
    marketplace: string,
    topic: string,
    n: NormalizedWebhook,
  ): Promise<{ record: WebhookInboxDocument; isNew: boolean }> {
    try {
      const record = await this.model.create({
        marketplace, topic, kind: n.kind === 'ignore' ? 'unparseable' : n.kind,
        eventId: n.eventId, externalId: n.externalId, resource: n.resource,
        payload: n.raw, status: 'pending', attempts: 0, maxAttempts: 8,
        receivedAt: new Date(), nextRetryAt: new Date(),
      });
      return { record, isNew: true };
    } catch (err: any) {
      if (err?.code === 11000) {
        const existing = await this.model.findOne({ eventId: n.eventId }).exec();
        if (existing) return { record: existing, isNew: false };
      }
      throw err;
    }
  }

  async appendDead(marketplace: string, topic: string, eventId: string, payload: any, error: string): Promise<void> {
    try {
      await this.model.create({
        marketplace, topic, kind: 'unparseable', eventId, payload,
        status: 'dead', attempts: 0, maxAttempts: 0, receivedAt: new Date(), lastError: error,
      });
    } catch (err: any) {
      if (err?.code !== 11000) throw err;
    }
  }
}
```

- [ ] **Step 4: Rodar — deve passar**

Run: `cd backend && npm test -- --runInBand webhook-inbox.service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd backend && git add src/webhook/inbox/webhook-inbox.service.* && git commit -m "feat(webhook): inbox service append idempotente (dedupe por eventId)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 5.3: WebhookInboxWorker (lease + reaper + backoff)

**Files:**
- Create: `src/webhook/inbox/webhook-inbox.worker.ts`
- Test: `src/webhook/inbox/webhook-inbox.worker.spec.ts`

- [ ] **Step 1: Teste — done, retry, dead, e claim com lease**

```typescript
// webhook-inbox.worker.spec.ts
import { WebhookInboxWorker } from './webhook-inbox.worker';

const makeSut = (dispatcherThrows = false, attempts = 0, maxAttempts = 8) => {
  const entry = { _id: 'e1', marketplace: 'mercadolivre', topic: 'orders_v2', kind: 'order',
    eventId: 'id1', externalId: '1', resource: '/orders/1', payload: { resource: '/orders/1' },
    receivedAt: new Date(), attempts, maxAttempts };
  const model: any = {
    find: jest.fn().mockReturnValue({ sort: () => ({ limit: () => ({ lean: () => ({ exec: () => Promise.resolve([entry]) }) }) }) }),
    findOneAndUpdate: jest.fn().mockResolvedValue(entry),
    findByIdAndUpdate: jest.fn().mockResolvedValue(undefined),
  };
  const dispatcher = { dispatch: dispatcherThrows ? jest.fn().mockRejectedValue(new Error('boom')) : jest.fn().mockResolvedValue(undefined) };
  const config = { get: jest.fn((k: string, f?: any) => f) };
  const metrics = { incDead: jest.fn() };
  return { worker: new WebhookInboxWorker(model, dispatcher as any, config as any, metrics as any), model, dispatcher, metrics };
};

describe('WebhookInboxWorker', () => {
  it('claim grava owner + leaseUntil', async () => {
    const { worker, model } = makeSut();
    await worker.processPending();
    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: 'e1' }),
      expect.objectContaining({ status: 'processing', owner: expect.any(String), leaseUntil: expect.any(Date) }),
      expect.anything(),
    );
  });

  it('sucesso → done', async () => {
    const { worker, model } = makeSut(false);
    await worker.processPending();
    expect(model.findByIdAndUpdate).toHaveBeenCalledWith('e1', expect.objectContaining({ status: 'done' }));
  });

  it('falha com tentativas restantes → pending + backoff', async () => {
    const { worker, model } = makeSut(true, 0, 8);
    await worker.processPending();
    expect(model.findByIdAndUpdate).toHaveBeenCalledWith('e1', expect.objectContaining({ status: 'pending', attempts: 1 }));
  });

  it('falha esgotando tentativas → dead + métrica', async () => {
    const { worker, model, metrics } = makeSut(true, 7, 8);
    await worker.processPending();
    expect(model.findByIdAndUpdate).toHaveBeenCalledWith('e1', expect.objectContaining({ status: 'dead' }));
    expect(metrics.incDead).toHaveBeenCalledWith('mercadolivre', 'order');
  });
});
```

- [ ] **Step 2: Rodar — deve falhar**

Run: `cd backend && npm test -- --runInBand webhook-inbox.worker`
Expected: FAIL.

- [ ] **Step 3: Implementar**

```typescript
// webhook-inbox.worker.ts
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'crypto';
import { Model } from 'mongoose';
import { WebhookInboxDocument, WebhookInboxModel } from './webhook-inbox.schema';
import { WebhookDispatcher } from '../dispatch/webhook-dispatcher.service';
import { WebhookMetricsService } from '../observability/webhook-metrics.service';

@Injectable()
export class WebhookInboxWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookInboxWorker.name);
  private readonly owner = randomUUID();
  private running = false;
  private intervalRef?: NodeJS.Timeout;

  constructor(
    @InjectModel(WebhookInboxModel.name) private readonly model: Model<WebhookInboxDocument>,
    private readonly dispatcher: WebhookDispatcher,
    private readonly config: ConfigService,
    private readonly metrics: WebhookMetricsService,
  ) {}

  onModuleInit(): void {
    setTimeout(() => this.safeRun(), 10_000);
    const intervalMs = this.num('WEBHOOK_INBOX_CRON_SECONDS', 30) * 1000;
    this.intervalRef = setInterval(() => this.safeRun(), intervalMs);
  }
  onModuleDestroy(): void {
    if (this.intervalRef) clearInterval(this.intervalRef);
  }
  private safeRun() {
    this.processPending().catch((e) => this.logger.error(`[Inbox] run failed: ${e.message}`));
  }

  async processPending(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = new Date();
      const leaseMs = this.num('WEBHOOK_INBOX_LEASE_SECONDS', 300) * 1000;
      const batch = this.num('WEBHOOK_INBOX_BATCH_SIZE', 50);

      const candidates = await this.model
        .find({
          $or: [
            { status: 'pending', $or: [{ nextRetryAt: { $exists: false } }, { nextRetryAt: { $lte: now } }] },
            { status: 'processing', leaseUntil: { $lte: now } }, // reaper
          ],
        })
        .sort({ createdAt: 1 }).limit(batch).lean().exec();

      for (const c of candidates) {
        const claimed = await this.model.findOneAndUpdate(
          { _id: (c as any)._id, $or: [{ status: 'pending' }, { status: 'processing', leaseUntil: { $lte: now } }] },
          { status: 'processing', owner: this.owner, leaseUntil: new Date(Date.now() + leaseMs), processingAt: new Date() } as any,
          { new: true },
        );
        if (!claimed) continue;
        await this.processOne(claimed);
      }
    } finally {
      this.running = false;
    }
  }

  private async processOne(entry: WebhookInboxDocument): Promise<void> {
    try {
      await this.dispatcher.dispatch({
        marketplace: entry.marketplace, topic: entry.topic, kind: entry.kind as any,
        externalId: entry.externalId, resource: entry.resource, payload: entry.payload, receivedAt: entry.receivedAt ?? new Date(),
      });
      await this.model.findByIdAndUpdate(entry._id, { status: 'done', processedAt: new Date(), lastError: null });
    } catch (err) {
      const attempts = Number(entry.attempts || 0) + 1;
      const max = Number(entry.maxAttempts || 8);
      const dead = attempts >= max;
      await this.model.findByIdAndUpdate(entry._id, {
        status: dead ? 'dead' : 'pending', attempts, lastError: (err as Error).message,
        leaseUntil: null, nextRetryAt: dead ? null : new Date(Date.now() + this.backoff(attempts)),
      });
      if (dead) {
        this.metrics.incDead(entry.marketplace, entry.kind);
        this.logger.error(`[Inbox] DEAD id=${entry._id} eventId=${entry.eventId} attempts=${attempts} err=${(err as Error).message}`);
      } else {
        this.logger.warn(`[Inbox] retry id=${entry._id} attempts=${attempts}/${max}: ${(err as Error).message}`);
      }
    }
  }

  private backoff(attempts: number): number {
    const base = this.num('WEBHOOK_INBOX_RETRY_BASE_MS', 30_000);
    return base * 2 ** (Math.min(attempts, 6) - 1);
  }
  private num(key: string, def: number): number {
    const v = Number(this.config.get(key));
    return Number.isFinite(v) && v > 0 ? v : def;
  }
}
```

- [ ] **Step 4: Rodar — deve passar**

Run: `cd backend && npm test -- --runInBand webhook-inbox.worker`
Expected: PASS (claim com lease, done, retry, dead+métrica).

- [ ] **Step 5: Commit**

```bash
cd backend && git add src/webhook/inbox/webhook-inbox.worker.* && git commit -m "feat(webhook): inbox worker com lease/reaper + backoff + DLQ

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## FASE 6 — Dispatcher e métricas

### Task 6.1: WebhookMetricsService

**Files:**
- Create: `src/webhook/observability/webhook-metrics.service.ts`
- Test: `src/webhook/observability/webhook-metrics.service.spec.ts`

- [ ] **Step 1: Teste — contadores**

```typescript
// webhook-metrics.service.spec.ts
import { WebhookMetricsService } from './webhook-metrics.service';

describe('WebhookMetricsService', () => {
  it('conta received, rejected e dead por chave', () => {
    const sut = new WebhookMetricsService();
    sut.incReceived('mercadolivre', 'order');
    sut.incReceived('mercadolivre', 'order');
    sut.incRejected('shopee', 'bad_signature');
    sut.incDead('amazon', 'order');
    const snap = sut.snapshot();
    expect(snap.received['mercadolivre:order']).toBe(2);
    expect(snap.rejected['shopee:bad_signature']).toBe(1);
    expect(snap.dead['amazon:order']).toBe(1);
  });
});
```

- [ ] **Step 2: Rodar — deve falhar**

Run: `cd backend && npm test -- --runInBand webhook-metrics`
Expected: FAIL.

- [ ] **Step 3: Implementar (contadores em memória; sem dep externa)**

```typescript
// webhook-metrics.service.ts
import { Injectable } from '@nestjs/common';

@Injectable()
export class WebhookMetricsService {
  private readonly received = new Map<string, number>();
  private readonly rejected = new Map<string, number>();
  private readonly dead = new Map<string, number>();

  incReceived(marketplace: string, kind: string) { this.bump(this.received, `${marketplace}:${kind}`); }
  incRejected(marketplace: string, reason: string) { this.bump(this.rejected, `${marketplace}:${reason}`); }
  incDead(marketplace: string, kind: string) { this.bump(this.dead, `${marketplace}:${kind}`); }

  snapshot() {
    return { received: this.toObj(this.received), rejected: this.toObj(this.rejected), dead: this.toObj(this.dead) };
  }
  private bump(m: Map<string, number>, k: string) { m.set(k, (m.get(k) ?? 0) + 1); }
  private toObj(m: Map<string, number>) { return Object.fromEntries(m); }
}
```

- [ ] **Step 4: Rodar — deve passar**

Run: `cd backend && npm test -- --runInBand webhook-metrics`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd backend && git add src/webhook/observability/ && git commit -m "feat(webhook): métricas em memória (received/rejected/dead)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 6.2: WebhookDispatcher (switch por kind)

**Files:**
- Create: `src/webhook/dispatch/webhook-dispatcher.service.ts`
- Test: `src/webhook/dispatch/webhook-dispatcher.service.spec.ts`

- [ ] **Step 1: Teste — kind → comando, shape preservado**

```typescript
// webhook-dispatcher.service.spec.ts
import { WebhookDispatcher } from './webhook-dispatcher.service';
import { WEBHOOK_DOMAIN_COMMANDS } from '../events/webhook.events';

describe('WebhookDispatcher.dispatch', () => {
  const makeSut = () => {
    const emitter = { emitAsync: jest.fn().mockResolvedValue([]) };
    return { sut: new WebhookDispatcher(emitter as any), emitter };
  };
  const base = { marketplace: 'mercadolivre', topic: 'orders_v2', externalId: '1', resource: '/orders/1', payload: {}, receivedAt: new Date() };

  it('order → ORDER_SYNC_REQUESTED com shape esperado', async () => {
    const { sut, emitter } = makeSut();
    await sut.dispatch({ ...base, kind: 'order' });
    expect(emitter.emitAsync).toHaveBeenCalledWith(
      WEBHOOK_DOMAIN_COMMANDS.ORDER_SYNC_REQUESTED,
      expect.objectContaining({ marketplace: 'mercadolivre', externalOrderId: '1', resource: '/orders/1', source: 'webhook' }),
    );
  });

  it('order_pack → ORDER_PACK_SYNC_REQUESTED', async () => {
    const { sut, emitter } = makeSut();
    await sut.dispatch({ ...base, kind: 'order_pack', externalId: '55', resource: '/packs/55' });
    expect(emitter.emitAsync).toHaveBeenCalledWith(
      WEBHOOK_DOMAIN_COMMANDS.ORDER_PACK_SYNC_REQUESTED,
      expect.objectContaining({ marketplace: 'mercadolivre', externalPackId: '55', source: 'webhook' }),
    );
  });

  it('question → QUESTION_INGEST_REQUESTED', async () => {
    const { sut, emitter } = makeSut();
    await sut.dispatch({ ...base, kind: 'question', externalId: '77', resource: '/questions/77' });
    expect(emitter.emitAsync).toHaveBeenCalledWith(
      WEBHOOK_DOMAIN_COMMANDS.QUESTION_INGEST_REQUESTED,
      expect.objectContaining({ externalQuestionId: '77' }),
    );
  });

  it('unparseable → não emite nada', async () => {
    const { sut, emitter } = makeSut();
    await sut.dispatch({ ...base, kind: 'unparseable' as any });
    expect(emitter.emitAsync).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar — deve falhar**

Run: `cd backend && npm test -- --runInBand webhook-dispatcher`
Expected: FAIL.

- [ ] **Step 3: Implementar**

```typescript
// webhook-dispatcher.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WEBHOOK_DOMAIN_COMMANDS } from '../events/webhook.events';

export interface DispatchInput {
  marketplace: string;
  topic: string;
  kind: 'order' | 'order_pack' | 'question' | 'unparseable';
  externalId?: string;
  resource?: string;
  payload: any;
  receivedAt: Date;
}

@Injectable()
export class WebhookDispatcher {
  private readonly logger = new Logger(WebhookDispatcher.name);

  constructor(private readonly emitter: EventEmitter2) {}

  async dispatch(input: DispatchInput): Promise<void> {
    if (!input.externalId && input.kind !== 'unparseable') {
      this.logger.warn(`[Dispatch] ${input.marketplace}/${input.topic} kind=${input.kind} sem externalId`);
      return;
    }
    switch (input.kind) {
      case 'order':
        await this.emitter.emitAsync(WEBHOOK_DOMAIN_COMMANDS.ORDER_SYNC_REQUESTED, {
          marketplace: input.marketplace, externalOrderId: input.externalId, resource: input.resource ?? null,
          receivedAt: input.receivedAt, source: 'webhook',
        });
        return;
      case 'order_pack':
        await this.emitter.emitAsync(WEBHOOK_DOMAIN_COMMANDS.ORDER_PACK_SYNC_REQUESTED, {
          marketplace: input.marketplace, externalPackId: input.externalId, resource: input.resource,
          receivedAt: input.receivedAt, source: 'webhook',
        });
        return;
      case 'question':
        await this.emitter.emitAsync(WEBHOOK_DOMAIN_COMMANDS.QUESTION_INGEST_REQUESTED, {
          marketplace: input.marketplace, externalQuestionId: input.externalId, resource: input.resource,
          receivedAt: input.receivedAt,
        });
        return;
      case 'unparseable':
        return; // nada a despachar
    }
  }
}
```

- [ ] **Step 4: Rodar — deve passar**

Run: `cd backend && npm test -- --runInBand webhook-dispatcher`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd backend && git add src/webhook/dispatch/ && git commit -m "feat(webhook): dispatcher genérico por kind (3 comandos preservados)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## FASE 7 — Ingress (guard, service) e controller

### Task 7.1: WebhookContext + WebhookIngressGuard

**Files:**
- Create: `src/webhook/ingress/webhook-context.ts`
- Create: `src/webhook/ingress/webhook-ingress.guard.ts`
- Test: `src/webhook/ingress/webhook-ingress.guard.spec.ts`

- [ ] **Step 1: Teste do guard (404 desconhecido, 401 assinatura, 200 ok, SNS confirm)**

```typescript
// webhook-ingress.guard.spec.ts
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { WebhookIngressGuard } from './webhook-ingress.guard';

const makeCtx = (params: any, payload: any = {}, headers: any = {}) => ({
  switchToHttp: () => ({ getRequest: () => ({ params, body: payload, headers, rawBody: Buffer.from(JSON.stringify(payload)) }) }),
} as any);

describe('WebhookIngressGuard', () => {
  const adapter = { marketplace: 'mercadolivre', signatureScheme: { type: 'none' }, parse: jest.fn() };
  const makeSut = (has = true, verifyResult = true) => {
    const registry = { get: jest.fn().mockReturnValue(has ? adapter : undefined), has: jest.fn().mockReturnValue(has) };
    const verifier = { verify: jest.fn().mockResolvedValue(verifyResult) };
    const metrics = { incRejected: jest.fn() };
    return { sut: new WebhookIngressGuard(registry as any, verifier as any, metrics as any), registry, verifier, metrics };
  };

  it('marketplace desconhecido → NotFound', async () => {
    const { sut } = makeSut(false);
    await expect(sut.canActivate(makeCtx({ marketplace: 'xpto', topic: 't' }))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('assinatura inválida → Unauthorized + métrica', async () => {
    const { sut, metrics } = makeSut(true, false);
    await expect(sut.canActivate(makeCtx({ marketplace: 'mercadolivre', topic: 't' }))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(metrics.incRejected).toHaveBeenCalledWith('mercadolivre', 'bad_signature');
  });

  it('ok → true e anexa adapter+context no request', async () => {
    const { sut } = makeSut(true, true);
    const req: any = { params: { marketplace: 'mercadolivre', topic: 't' }, body: {}, headers: {}, rawBody: Buffer.from('{}') };
    const context = { switchToHttp: () => ({ getRequest: () => req }) } as any;
    await expect(sut.canActivate(context)).resolves.toBe(true);
    expect(req.webhookAdapter).toBe(adapter);
    expect(req.webhookContext.marketplace).toBe('mercadolivre');
  });
});
```

- [ ] **Step 2: Rodar — deve falhar**

Run: `cd backend && npm test -- --runInBand webhook-ingress.guard`
Expected: FAIL.

- [ ] **Step 3: Implementar context + guard**

```typescript
// webhook-context.ts
import { WebhookContext } from '../adapters/webhook-adapter.interface';

export function buildWebhookContext(req: any): WebhookContext {
  const headers: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.headers || {})) headers[k.toLowerCase()] = v as string;
  return {
    marketplace: String(req.params?.marketplace || '').toLowerCase(),
    topic: String(req.params?.topic || req.body?.topic || 'unknown'),
    headers,
    rawBody: req.rawBody,
    payload: req.body,
  };
}
```

```typescript
// webhook-ingress.guard.ts
import { CanActivate, ExecutionContext, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { WebhookAdapterRegistry } from '../adapters/webhook-adapter.registry';
import { SignatureVerifier } from '../crypto/signature-verifier.service';
import { WebhookMetricsService } from '../observability/webhook-metrics.service';
import { buildWebhookContext } from './webhook-context';

@Injectable()
export class WebhookIngressGuard implements CanActivate {
  constructor(
    private readonly registry: WebhookAdapterRegistry,
    private readonly verifier: SignatureVerifier,
    private readonly metrics: WebhookMetricsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const ctx = buildWebhookContext(req);

    const adapter = this.registry.get(ctx.marketplace);
    if (!adapter) {
      this.metrics.incRejected(ctx.marketplace || 'unknown', 'unknown_marketplace');
      throw new NotFoundException(`Webhook marketplace desconhecido: ${ctx.marketplace}`);
    }

    const ok = await this.verifier.verify(adapter.signatureScheme, ctx);
    if (!ok) {
      this.metrics.incRejected(ctx.marketplace, 'bad_signature');
      throw new UnauthorizedException('Assinatura de webhook inválida');
    }

    req.webhookAdapter = adapter;
    req.webhookContext = ctx;
    return true;
  }
}
```

- [ ] **Step 4: Rodar — deve passar**

Run: `cd backend && npm test -- --runInBand webhook-ingress.guard`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd backend && git add src/webhook/ingress/webhook-context.ts src/webhook/ingress/webhook-ingress.guard.* && git commit -m "feat(webhook): ingress guard fail-closed (resolve adapter + verifica assinatura)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 7.2: WebhookIngressService (parse → inbox → ack)

**Files:**
- Create: `src/webhook/ingress/webhook-ingress.service.ts`
- Test: `src/webhook/ingress/webhook-ingress.service.spec.ts`

- [ ] **Step 1: Teste — ignore (não persiste), order (persiste), parse lança (dead), Amazon SubscriptionConfirmation**

```typescript
// webhook-ingress.service.spec.ts
import { WebhookIngressService } from './webhook-ingress.service';

const makeSut = () => {
  const inbox = { append: jest.fn().mockResolvedValue({ record: { _id: 'r' }, isNew: true }), appendDead: jest.fn().mockResolvedValue(undefined) };
  const metrics = { incReceived: jest.fn() };
  const sut = new WebhookIngressService(inbox as any, metrics as any);
  return { sut, inbox, metrics };
};

const ctxFor = (parseImpl: any, payload: any = {}) => ({
  webhookContext: { marketplace: 'mercadolivre', topic: 'orders_v2', headers: {}, payload, rawBody: Buffer.from('{}') },
  webhookAdapter: { marketplace: 'mercadolivre', parse: parseImpl },
});

describe('WebhookIngressService.ingest', () => {
  it('kind ignore → não persiste', async () => {
    const { sut, inbox } = makeSut();
    const { webhookContext, webhookAdapter } = ctxFor(() => ({ kind: 'ignore', eventId: 'x', raw: {} }));
    const r = await sut.ingest(webhookAdapter as any, webhookContext as any);
    expect(inbox.append).not.toHaveBeenCalled();
    expect(r.success).toBe(true);
  });

  it('kind order → persiste no inbox + métrica', async () => {
    const { sut, inbox, metrics } = makeSut();
    const { webhookContext, webhookAdapter } = ctxFor(() => ({ kind: 'order', eventId: 'mercadolivre:orders_v2:/orders/1', externalId: '1', resource: '/orders/1', raw: {} }));
    await sut.ingest(webhookAdapter as any, webhookContext as any);
    expect(inbox.append).toHaveBeenCalled();
    expect(metrics.incReceived).toHaveBeenCalledWith('mercadolivre', 'order');
  });

  it('parse lança → appendDead + ack success', async () => {
    const { sut, inbox } = makeSut();
    const { webhookContext, webhookAdapter } = ctxFor(() => { throw new Error('payload ruim'); });
    const r = await sut.ingest(webhookAdapter as any, webhookContext as any);
    expect(inbox.appendDead).toHaveBeenCalled();
    expect(r.success).toBe(true);
  });

  it('Amazon SubscriptionConfirmation → confirma URL e não persiste', async () => {
    const { sut, inbox } = makeSut();
    const confirm = jest.fn().mockResolvedValue(undefined);
    const ctx = { marketplace: 'amazon', topic: 't', headers: {}, payload: { Type: 'SubscriptionConfirmation', SubscribeURL: 'https://x' }, rawBody: Buffer.from('{}') };
    const adapter = { marketplace: 'amazon', parse: () => ({ kind: 'ignore', eventId: 'a', raw: {} }), confirmSubscription: confirm };
    const r = await sut.ingest(adapter as any, ctx as any);
    expect(confirm).toHaveBeenCalledWith('https://x');
    expect(inbox.append).not.toHaveBeenCalled();
    expect(r.success).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar — deve falhar**

Run: `cd backend && npm test -- --runInBand webhook-ingress.service`
Expected: FAIL.

- [ ] **Step 3: Implementar (SubscriptionConfirmation via método opcional do adapter)**

Adicionar ao `WebhookAdapter` (interface, Task 1.1) um membro opcional:
```typescript
// em webhook-adapter.interface.ts — adicionar à interface WebhookAdapter:
  confirmSubscription?(subscribeUrl: string): Promise<void>;
```
(Apenas o AmazonAdapter implementa; usa axios.get na URL.)

```typescript
// webhook-ingress.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { WebhookAdapter, WebhookContext } from '../adapters/webhook-adapter.interface';
import { WebhookInboxService } from '../inbox/webhook-inbox.service';
import { WebhookMetricsService } from '../observability/webhook-metrics.service';

@Injectable()
export class WebhookIngressService {
  private readonly logger = new Logger(WebhookIngressService.name);

  constructor(
    private readonly inbox: WebhookInboxService,
    private readonly metrics: WebhookMetricsService,
  ) {}

  async ingest(adapter: WebhookAdapter, ctx: WebhookContext): Promise<{ success: true }> {
    // SNS/Amazon: confirmação de assinatura é efeito colateral, não vira evento
    if (ctx.payload?.Type === 'SubscriptionConfirmation' && adapter.confirmSubscription && ctx.payload?.SubscribeURL) {
      await adapter.confirmSubscription(ctx.payload.SubscribeURL);
      return { success: true };
    }

    let normalized;
    try {
      normalized = adapter.parse(ctx);
    } catch (err) {
      const eventId = `${ctx.marketplace}:${ctx.topic}:unparseable:${Date.now()}`;
      await this.inbox.appendDead(ctx.marketplace, ctx.topic, eventId, ctx.payload, (err as Error).message);
      this.logger.error(`[Ingress] parse falhou ${ctx.marketplace}/${ctx.topic}: ${(err as Error).message}`);
      return { success: true }; // ACK 200: não fazer o marketplace reenviar lixo
    }

    if (normalized.kind === 'ignore') {
      return { success: true };
    }

    await this.inbox.append(ctx.marketplace, ctx.topic, normalized);
    this.metrics.incReceived(ctx.marketplace, normalized.kind);
    return { success: true };
  }
}
```

- [ ] **Step 4: Implementar AmazonAdapter.confirmSubscription**

Em `src/webhook/adapters/amazon.adapter.ts`, adicionar:
```typescript
import axios from 'axios';
// ...
  async confirmSubscription(subscribeUrl: string): Promise<void> {
    await axios.get(subscribeUrl);
  }
```

- [ ] **Step 5: Rodar — deve passar**

Run: `cd backend && npm test -- --runInBand webhook-ingress.service`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd backend && git add src/webhook/ingress/webhook-ingress.service.* src/webhook/adapters/amazon.adapter.ts src/webhook/adapters/webhook-adapter.interface.ts && git commit -m "feat(webhook): ingress service (parse→inbox→ack, dead em parse falho, SNS confirm)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 7.3: Controller genérico

**Files:**
- Create (substituir): `src/webhook/webhook.controller.ts`
- Test: `src/webhook/webhook.controller.spec.ts`

- [ ] **Step 1: Teste — delega ao ingress com adapter/context do request**

```typescript
// webhook.controller.spec.ts
import { WebhookController } from './webhook.controller';

describe('WebhookController', () => {
  it('chama ingress.ingest com adapter e context anexados pelo guard', async () => {
    const ingress = { ingest: jest.fn().mockResolvedValue({ success: true }) };
    const sut = new WebhookController(ingress as any);
    const req: any = { webhookAdapter: { marketplace: 'mercadolivre' }, webhookContext: { marketplace: 'mercadolivre' } };
    const r = await sut.handle('mercadolivre', 'orders_v2', req);
    expect(ingress.ingest).toHaveBeenCalledWith(req.webhookAdapter, req.webhookContext);
    expect(r).toEqual({ success: true });
  });
});
```

- [ ] **Step 2: Rodar — deve falhar**

Run: `cd backend && npm test -- --runInBand webhook.controller`
Expected: FAIL.

- [ ] **Step 3: Implementar (1 endpoint genérico + variante sem topic p/ ML)**

```typescript
// webhook.controller.ts
import { Controller, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SkipJwtAuth } from '../auth/decorators/skip-jwt-auth.decorator';
import { WebhookIngressGuard } from './ingress/webhook-ingress.guard';
import { WebhookIngressService } from './ingress/webhook-ingress.service';

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhookController {
  constructor(private readonly ingress: WebhookIngressService) {}

  @Post(':marketplace/:topic')
  @SkipJwtAuth()
  @UseGuards(WebhookIngressGuard)
  @HttpCode(200)
  @ApiOperation({ summary: 'Receber webhook de marketplace (genérico)' })
  @ApiParam({ name: 'marketplace' })
  @ApiParam({ name: 'topic' })
  @ApiResponse({ status: 200 })
  async handle(@Param('marketplace') _m: string, @Param('topic') _t: string, @Req() req: any) {
    return this.ingress.ingest(req.webhookAdapter, req.webhookContext);
  }

  @Post(':marketplace')
  @SkipJwtAuth()
  @UseGuards(WebhookIngressGuard)
  @HttpCode(200)
  @ApiOperation({ summary: 'Receber webhook de marketplace sem topic na rota (ML genérico)' })
  @ApiParam({ name: 'marketplace' })
  @ApiResponse({ status: 200 })
  async handleNoTopic(@Param('marketplace') _m: string, @Req() req: any) {
    return this.ingress.ingest(req.webhookAdapter, req.webhookContext);
  }
}
```

- [ ] **Step 4: Rodar — deve passar**

Run: `cd backend && npm test -- --runInBand webhook.controller`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd backend && git add src/webhook/webhook.controller.* && git commit -m "feat(webhook): controller genérico (1 endpoint :marketplace/:topic)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## FASE 8 — Wiring (module) e cleanup

### Task 8.1: Reescrever WebhookModule

**Files:**
- Modify: `src/webhook/webhook.module.ts`

- [ ] **Step 1: Reescrever o módulo**

```typescript
// webhook.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DiscoveryModule } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { WebhookController } from './webhook.controller';
import { WebhookIngressService } from './ingress/webhook-ingress.service';
import { WebhookIngressGuard } from './ingress/webhook-ingress.guard';
import { SignatureVerifier } from './crypto/signature-verifier.service';
import { WebhookAdapterRegistry } from './adapters/webhook-adapter.registry';
import { WebhookInboxModel, WebhookInboxSchema } from './inbox/webhook-inbox.schema';
import { WebhookInboxService } from './inbox/webhook-inbox.service';
import { WebhookInboxWorker } from './inbox/webhook-inbox.worker';
import { WebhookDispatcher } from './dispatch/webhook-dispatcher.service';
import { WebhookMetricsService } from './observability/webhook-metrics.service';
import { MercadoLivreAdapter } from './adapters/mercadolivre.adapter';
import { ShopeeAdapter } from './adapters/shopee.adapter';
import { AmazonAdapter } from './adapters/amazon.adapter';
import { MagaluAdapter } from './adapters/magalu.adapter';
import { B2WAdapter } from './adapters/b2w.adapter';
import { ViaVarejoAdapter } from './adapters/viavarejo.adapter';
import { YampiAdapter } from './adapters/yampi.adapter';
import { OLXAdapter } from './adapters/olx.adapter';
import { AliExpressAdapter } from './adapters/aliexpress.adapter';
import { TikTokShopAdapter } from './adapters/tiktokshop.adapter';

@Module({
  imports: [
    ConfigModule,
    DiscoveryModule,
    MongooseModule.forFeature([{ name: WebhookInboxModel.name, schema: WebhookInboxSchema }]),
  ],
  controllers: [WebhookController],
  providers: [
    WebhookIngressService, WebhookIngressGuard, SignatureVerifier,
    WebhookAdapterRegistry, WebhookInboxService, WebhookInboxWorker,
    WebhookDispatcher, WebhookMetricsService,
    MercadoLivreAdapter, ShopeeAdapter, AmazonAdapter, MagaluAdapter, B2WAdapter,
    ViaVarejoAdapter, YampiAdapter, OLXAdapter, AliExpressAdapter, TikTokShopAdapter,
  ],
})
export class WebhookModule {}
```
(Não importa `MarketplaceCredentialsModule` — é `@Global`, então `SignatureVerifier` injeta `MarketplaceCredentialsService` direto. **Zero forwardRef.**)

- [ ] **Step 2: Build**

Run: `cd backend && npm run build`
Expected: OK (todos os providers resolvem; DiscoveryModule disponível).

- [ ] **Step 3: Commit**

```bash
cd backend && git add src/webhook/webhook.module.ts && git commit -m "feat(webhook): wiring do módulo (discovery, inbox, adapters) sem forwardRef

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 8.2: Deletar arquivos legados

**Files:** (deletar)
- `src/webhook/webhook.service.ts`, `src/webhook/webhook.service.spec.ts`
- `src/webhook/services/` (todo o diretório: 10 *-webhook.service.ts + webhook-adapter.registry.ts + webhook-inbox.service.ts + webhook-inbox-policy.service.ts + 3 specs)
- `src/webhook/guards/` (webhook-signature.guard.ts + spec)
- `src/webhook/consumers/` (webhook-dispatcher.service.ts + spec + webhook-inbox.worker.ts + spec)

- [ ] **Step 1: Remover os arquivos**

```bash
cd backend
git rm src/webhook/webhook.service.ts src/webhook/webhook.service.spec.ts
git rm -r src/webhook/services src/webhook/guards src/webhook/consumers
```

- [ ] **Step 2: Verificar que nada externo importava os removidos**

```bash
cd backend && grep -rn "webhook/webhook.service\|webhook/services/\|webhook/guards/\|webhook/consumers/\|WebhookService\b" src --include=*.ts | grep -v "src/webhook/"
```
Expected: nenhum hit fora de `src/webhook/`. (Se houver, ajustar import — esperado: zero, pois só `WebhookService` era exportado e o controller era o único consumidor.)

- [ ] **Step 3: Build + suíte completa de webhook**

Run: `cd backend && npm run build && npm test -- --runInBand src/webhook`
Expected: build OK; todos os specs novos PASS; nenhum spec órfão.

- [ ] **Step 4: Commit**

```bash
cd backend && git add -A && git commit -m "chore(webhook): remove camada legada (service/registry-switch/policy/guard/consumers)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## FASE 9 — Credenciais/URLs via tabela (escopo correlato)

### Task 9.1: Migrar segredos de webhook para fallback MP_<TAG>_WEBHOOKSECRET

Os adapters já declaram `secretKey: 'webhookSecret'` e o `SignatureVerifier` lê via `MarketplaceCredentialsService` (DB → `MP_<TAG>_WEBHOOKSECRET` env fallback). Esta task documenta a transição e remove os `*_WEBHOOK_SECRET` antigos.

**Files:**
- Modify: `backend/.env.example` (se existir) e doc de operação

- [ ] **Step 1: Mapear env antigo → novo**

Documentar no `.env.example` a substituição (NÃO há código lendo o nome antigo após a reescrita — os `*-webhook.service.ts` foram deletados):

```
# REMOVIDO (lido pelos antigos *-webhook.service.ts):
#   MERCADO_LIVRE_WEBHOOK_SECRET, MAGALU_WEBHOOK_SECRET, B2W_WEBHOOK_SECRET,
#   VIAVAREJO_WEBHOOK_SECRET, YAMPI_WEBHOOK_SECRET, ALIEXPRESS_WEBHOOK_SECRET,
#   SHOPEE_PARTNER_SECRET_<id>
# AGORA (fonte: marketplaces.credentials; fallback transitório via env):
#   MP_MERCADOLIVRE_WEBHOOKSECRET=...
#   MP_MAGALU_WEBHOOKSECRET=...   (idem b2w, viavarejo, yampi, aliexpress)
#   Shopee partnerKey: registrar em accounts[].credentials.partnerKey
# Preferir registrar via POST /marketplace-auth/:id/credentials (cifrado em DB).
```

- [ ] **Step 2: Verificar que nenhum código referencia os nomes antigos**

```bash
cd backend && grep -rn "WEBHOOK_SECRET\|SHOPEE_PARTNER_SECRET" src --include=*.ts
```
Expected: zero hits (todos os antigos adapters foram deletados na Task 8.2).

- [ ] **Step 3: Commit**

```bash
cd backend && git add .env.example && git commit -m "docs(webhook): segredos de webhook migram para marketplaces.credentials

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 9.2: REDIRECT_URI de OLX/Magalu via marketplaces.settings

**Files:**
- Modify: `src/marketplace/adapters/magalu/magalu-auth.adapter.ts`
- Modify: `src/marketplace/adapters/olx/olx-auth.service.ts`
- Modify: `src/marketplace/adapters/olx/olx.controller.ts`

- [ ] **Step 1: Teste — resolução settings → env fallback (Magalu)**

```typescript
// magalu-auth.adapter.spec.ts (criar; testa o helper de resolução)
import { resolveRedirectUri } from './magalu-auth.adapter';

describe('resolveRedirectUri (magalu)', () => {
  it('prefere settings.redirectUri', () => {
    expect(resolveRedirectUri({ settings: { redirectUri: 'https://db' } } as any, 'https://env')).toBe('https://db');
  });
  it('cai no env quando settings ausente', () => {
    expect(resolveRedirectUri({ settings: {} } as any, 'https://env')).toBe('https://env');
  });
});
```

- [ ] **Step 2: Rodar — deve falhar**

Run: `cd backend && npm test -- --runInBand magalu-auth.adapter`
Expected: FAIL.

- [ ] **Step 3: Implementar helper exportado + usar nos pontos**

Em `magalu-auth.adapter.ts`, extrair e usar:
```typescript
export function resolveRedirectUri(marketplace: { settings?: any } | null, envFallback?: string): string {
  return marketplace?.settings?.redirectUri || envFallback || '';
}
```
Substituir `this.redirectUri = process.env.MAGALU_REDIRECT_URI!` por resolução via `MarketplaceRegistryService` (já injetável) lendo `settings.redirectUri`, com `process.env.MAGALU_REDIRECT_URI` como fallback transitório. Aplicar o mesmo padrão em `olx-auth.service.ts` (substituir `this.configService.get('OLX_REDIRECT_URI')`) e `olx.controller.ts`.

- [ ] **Step 4: Rodar — deve passar**

Run: `cd backend && npm test -- --runInBand magalu-auth.adapter`
Expected: PASS.

- [ ] **Step 5: Build + commit**

```bash
cd backend && npm run build && git add -A && git commit -m "refactor(marketplace): REDIRECT_URI de OLX/Magalu via settings (fallback env)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## FASE 10 — Verificação final

### Task 10.1: Suíte completa + smoke

- [ ] **Step 1: Suíte completa**

Run: `cd backend && npm test -- --runInBand`
Expected: verde. (Se algum spec não-webhook quebrar por causa da FASE 0, investigar import.)

- [ ] **Step 2: Build de produção**

Run: `cd backend && npm run build`
Expected: OK.

- [ ] **Step 3: Verificar zero forwardRef novo e zero referência morta**

```bash
cd backend && grep -rn "forwardRef" src/webhook src/marketplace/credentials; grep -rn "WEBHOOK_EVENTS\|LISTING_UPDATED\|WebhookReceivedEvent" src --include=*.ts
```
Expected: zero hits.

- [ ] **Step 4: Checklist de contratos preservados**

Confirmar manualmente que os 3 listeners externos ainda recebem o shape esperado (já coberto pelos testes do dispatcher na Task 6.2). Sem alteração em `order/` ou `questions/`.

- [ ] **Step 5: Commit final (se houver ajustes)**

```bash
cd backend && git add -A && git commit -m "test(webhook): verificação final da camada de ingress

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Notas para o executor

- **Git:** todo commit roda em `backend/` (repo próprio). Confirme `git rev-parse --show-toplevel` termina em `/backend` antes de commitar.
- **Sem forwardRef:** se em qualquer task o NestJS pedir `forwardRef`, PARE — é sinal de ciclo. Redesenhe a fronteira (provavelmente o serviço precisa ir para um módulo `@Global`). Ver memória `avoid-forwardref-circular-deps`.
- **Sem fallback temporário deixado para trás:** os fallbacks de env (`MP_<TAG>_WEBHOOKSECRET`, `MAGALU_REDIRECT_URI`) são da camada `MarketplaceCredentialsService`/transição — não criar novos fallbacks dentro do webhook.
- **`--runInBand` sempre** (memória: jest-mongo-memory-server-contention).
- **`crypto.randomUUID()`**, nunca o pacote `uuid` (memória: uuid-esm-breaks-jest).
- **Ordem:** FASE 0 é pré-requisito de tudo. FASES 1-2 antes de 3. FASE 3-6 podem ser paralelizadas por subagentes. FASE 7 depende de 1-6. FASE 8 depois de 7. FASE 9 independe de webhook (pode ir em paralelo após FASE 0). FASE 10 por último.
