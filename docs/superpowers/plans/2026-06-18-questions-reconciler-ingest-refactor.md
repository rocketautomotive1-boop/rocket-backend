# Questions Reconciler + Single Ingest Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the Questions domain to the same maturity as the Orders domain — a single idempotent ingest entry-point fed by webhook + an adaptive delta reconciler (no full-scan), with product resolution optimized via positive + negative caching.

**Architecture:** Mirror the Orders ingest/reconcile pattern. Webhook and reconciler both funnel into one `QuestionIngestService.ingest()`. A pure `decideQuestionAction()` function encodes idempotency (CREATE / UPDATE_ANSWER / SKIP / RECOVER_NOTIFICATION). A `QuestionReconciler` keeps a per-marketplace high-water-mark cursor on `date_created` and polls only the delta, replacing the full-scan `syncQuestions()`. A `QuestionProductResolver` caches `item_id → productId` and negative-caches misses (TTL) so the ML `getItem` fallback never re-fires for the same item.

**Tech Stack:** NestJS, Mongoose, `@nestjs/event-emitter`, `@nestjs/schedule` (existing cron is removed), Jest.

## Global Constraints

- **Git topology:** `backend/` is its **own** git repo with default branch `main`. Run all `git` commands with cwd `backend/`. Verify with `git rev-parse --show-toplevel` before committing.
- **Validation messages in Portuguese** (project convention). Logs may stay in the existing mixed style of the file.
- **Use `crypto.randomUUID()`**, never the `uuid` package, in any testable code (uuid ESM breaks Jest in this repo).
- **Run Jest with `--runInBand`** for any suite using mongo-memory-server (parallel suites flake).
- **Pure-logic files must not import from `@nestjs/*` or mongoose** so they are unit-testable without bootstrapping Nest. `decideQuestionAction` and the cache helpers live in plain `.ts` files.
- **No new dependencies.** Negative cache is an in-process `Map` with timestamp TTL (same lightweight style as `marketplace-config-cache`).
- **Behavior decisions (locked):** (a) Questions for items with no local product persist with `product=null` and STILL notify. (b) The full-scan `syncQuestions()` / `getQuestions()` / `POST /questions/sync` / the 5-min cron are **removed entirely** — only webhook + reconciler remain.

---

## File Structure

**New files (under `backend/src/questions/`):**
- `ingest/question-ingest.decision.ts` — pure `decideQuestionAction()` + types. No framework imports.
- `ingest/question-ingest.decision.spec.ts` — unit tests for the pure decision.
- `ingest/question-ingest.service.ts` — single entry-point `ingest()`; fetch → decide → resolve → persist → notify.
- `ingest/question-ingest.service.spec.ts` — tests with mocked collaborators.
- `resolve/question-product.resolver.ts` — `QuestionProductResolver` with positive + negative cache.
- `resolve/question-product.resolver.spec.ts` — cache hit/miss/negative-cache tests.
- `reconcile/question-reconcile-checkpoint.schema.ts` — per-marketplace cursor doc.
- `reconcile/question-reconcile-cursor.ts` — pure `nextInterval` / `maxQuestionCursor` / `isStatusDivergent` helpers.
- `reconcile/question-reconcile-cursor.spec.ts` — unit tests for the helpers.
- `reconcile/question-reconciler.service.ts` — `QuestionReconciler` adaptive delta poller.

**Modified files:**
- `questions.service.ts` — strip `syncSingleQuestion`/`upsertQuestion`/`resolveProductId`/`syncQuestions`/`syncMercadoLivreQuestions`; keep read/answer APIs; move ingest logic out.
- `questions.controller.ts` — remove `POST /questions/sync`.
- `questions.module.ts` — register the new providers + checkpoint schema; export `QuestionIngestService`.
- `scheduler.service.ts` — remove `handleQuestionSync` cron + the `QuestionsService` injection.
- `mercado-livre.adapter.ts` — add `listQuestionsSince()` (delta); `getQuestions()` is removed.

**Interfaces produced for later tasks (canonical signatures):**

```typescript
// question-ingest.decision.ts
export type QuestionIngestSource = 'webhook' | 'reconcile' | 'manual';
export interface ExistingQuestionView {
  status?: string;            // 'UNANSWERED' | 'ANSWERED'
  product?: unknown | null;   // truthy when a product is already linked
  notified?: boolean;         // whether the 'question.received' notification was emitted
}
export interface IncomingQuestionView {
  status?: string;            // ML status
  hasAnswer?: boolean;
}
export type QuestionAction =
  | { kind: 'CREATE' }
  | { kind: 'UPDATE_ANSWER' }
  | { kind: 'LINK_PRODUCT' }
  | { kind: 'SKIP' }
  | { kind: 'RECOVER_NOTIFICATION' };
export function decideQuestionAction(
  existing: ExistingQuestionView | null,
  incoming: IncomingQuestionView,
): QuestionAction;

// question-product.resolver.ts
export class QuestionProductResolver {
  resolve(itemId: string, marketplace: any, token: string): Promise<Types.ObjectId | null>;
}

// question-ingest.service.ts
export class QuestionIngestService {
  ingest(externalQuestionId: string, source?: QuestionIngestSource): Promise<void>;
}

// question-reconcile-cursor.ts
export const QUESTION_RECONCILE: { FLOOR_MS: number; CEILING_MS: number; BOOTSTRAP_WINDOW_MS: number };
export function nextInterval(current: number, cleanRun: boolean): number;
export function maxQuestionCursor(refs: Array<{ date_created: string }>, fallback: Date): Date;
export function isStatusDivergent(local?: string, external?: string): boolean;

// mercado-livre.adapter.ts (new method)
//   listQuestionsSince(token, sellerId, since: Date): Promise<Array<{ id, item_id, status, date_created, ... }>>
```

The `notified` field is **new** on `QuestionModel` (Task 1) — it is what enables `RECOVER_NOTIFICATION`, exactly like Orders uses `notificationStatus.whatsapp.status`.

---

### Task 1: Add `notified` flag to QuestionModel

**Files:**
- Modify: `backend/src/questions/schemas/question.schema.ts`

**Interfaces:**
- Produces: `QuestionModel.notified: boolean` (default `false`) — read by `decideQuestionAction` and set true after a notification is emitted.

- [ ] **Step 1: Add the prop**

In `question.schema.ts`, after the `aiSuggestionUsed` prop, add:

```typescript
    @Prop({ default: false })
    notified: boolean;
```

- [ ] **Step 2: Build check**

Run: `cd backend && npx tsc --noEmit -p tsconfig.json`
Expected: no new errors referencing `question.schema.ts`.

- [ ] **Step 3: Commit**

```bash
cd backend && git add src/questions/schemas/question.schema.ts && git commit -m "feat(questions): add notified flag for notification recovery

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Pure idempotency decision `decideQuestionAction`

**Files:**
- Create: `backend/src/questions/ingest/question-ingest.decision.ts`
- Test: `backend/src/questions/ingest/question-ingest.decision.spec.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces: `decideQuestionAction`, `QuestionAction`, `QuestionIngestSource`, `ExistingQuestionView`, `IncomingQuestionView` (signatures in File Structure block).

**Decision rules (mirrors `order-ingest.decision.ts`):**
- No existing → `CREATE`.
- Existing, incoming has an answer and local status is still `UNANSWERED` → `UPDATE_ANSWER`.
- Existing, status unchanged, but no product linked locally and we can still try → `LINK_PRODUCT`.
- Existing, status unchanged, product state unchanged, but `notified === false` and still `UNANSWERED` → `RECOVER_NOTIFICATION`.
- Otherwise → `SKIP`.

- [ ] **Step 1: Write the failing test**

```typescript
// question-ingest.decision.spec.ts
import { decideQuestionAction } from './question-ingest.decision';

describe('decideQuestionAction', () => {
  it('no existing → CREATE', () => {
    expect(decideQuestionAction(null, { status: 'UNANSWERED' })).toEqual({ kind: 'CREATE' });
  });

  it('incoming answered while local unanswered → UPDATE_ANSWER', () => {
    expect(
      decideQuestionAction(
        { status: 'UNANSWERED', product: 'p', notified: true },
        { status: 'ANSWERED', hasAnswer: true },
      ),
    ).toEqual({ kind: 'UPDATE_ANSWER' });
  });

  it('unchanged but product missing → LINK_PRODUCT', () => {
    expect(
      decideQuestionAction(
        { status: 'UNANSWERED', product: null, notified: true },
        { status: 'UNANSWERED' },
      ),
    ).toEqual({ kind: 'LINK_PRODUCT' });
  });

  it('unchanged, product present, never notified, still unanswered → RECOVER_NOTIFICATION', () => {
    expect(
      decideQuestionAction(
        { status: 'UNANSWERED', product: 'p', notified: false },
        { status: 'UNANSWERED' },
      ),
    ).toEqual({ kind: 'RECOVER_NOTIFICATION' });
  });

  it('fully settled → SKIP', () => {
    expect(
      decideQuestionAction(
        { status: 'ANSWERED', product: 'p', notified: true },
        { status: 'ANSWERED', hasAnswer: true },
      ),
    ).toEqual({ kind: 'SKIP' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/questions/ingest/question-ingest.decision.spec.ts --runInBand`
Expected: FAIL — "Cannot find module './question-ingest.decision'".

- [ ] **Step 3: Write minimal implementation**

```typescript
// question-ingest.decision.ts
export type QuestionIngestSource = 'webhook' | 'reconcile' | 'manual';

export interface ExistingQuestionView {
  status?: string;
  product?: unknown | null;
  notified?: boolean;
}

export interface IncomingQuestionView {
  status?: string;
  hasAnswer?: boolean;
}

export type QuestionAction =
  | { kind: 'CREATE' }
  | { kind: 'UPDATE_ANSWER' }
  | { kind: 'LINK_PRODUCT' }
  | { kind: 'SKIP' }
  | { kind: 'RECOVER_NOTIFICATION' };

const uc = (s?: string) => (s ?? '').toUpperCase();

export function decideQuestionAction(
  existing: ExistingQuestionView | null,
  incoming: IncomingQuestionView,
): QuestionAction {
  if (!existing) return { kind: 'CREATE' };

  const localStatus = uc(existing.status);
  const inStatus = uc(incoming.status);

  if (localStatus === 'UNANSWERED' && (incoming.hasAnswer || inStatus === 'ANSWERED')) {
    return { kind: 'UPDATE_ANSWER' };
  }

  if (!existing.product) {
    return { kind: 'LINK_PRODUCT' };
  }

  if (localStatus === 'UNANSWERED' && existing.notified === false) {
    return { kind: 'RECOVER_NOTIFICATION' };
  }

  return { kind: 'SKIP' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/questions/ingest/question-ingest.decision.spec.ts --runInBand`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
cd backend && git add src/questions/ingest/question-ingest.decision.ts src/questions/ingest/question-ingest.decision.spec.ts && git commit -m "feat(questions): pure decideQuestionAction idempotency rules

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `QuestionProductResolver` with positive + negative cache

**Files:**
- Create: `backend/src/questions/resolve/question-product.resolver.ts`
- Test: `backend/src/questions/resolve/question-product.resolver.spec.ts`

**Interfaces:**
- Consumes: `ProductTitleService.findByExternalIdAndMarketplaceId(externalId, marketplaceId)`, `MercadoLivreService.getItem(itemId, token)`, `ProductService.findByBarcode(sku)`, `ProductTitleService.create(productId, dto)` — all already exist (see `questions.service.ts:297-354` for current usage).
- Produces: `QuestionProductResolver.resolve(itemId, marketplace, token): Promise<Types.ObjectId | null>`.

**Behavior:** This lifts the existing `resolveProductId` logic (Listing match → numeric/MLB fallback → `getItem`+SKU auto-link) and wraps it with two caches:
- **Positive cache:** `Map<string, string>` keyed `${marketplaceId}:${itemId}` → productId hex. Hit returns immediately.
- **Negative cache:** `Map<string, number>` same key → expiry epoch ms. A miss (no listing, no SKU match) records expiry `now + NEGATIVE_TTL_MS` (default 30 min). While unexpired, `resolve` returns `null` WITHOUT calling `getItem`. This kills the "20 getItem calls for one item" pattern measured in the data.

- [ ] **Step 1: Write the failing test**

```typescript
// question-product.resolver.spec.ts
import { Types } from 'mongoose';
import { QuestionProductResolver } from './question-product.resolver';

const mkt = { _id: new Types.ObjectId() };
const token = 'tok';

function makeSut(overrides: Partial<{
  titleFind: jest.Mock; getItem: jest.Mock; findByBarcode: jest.Mock; titleCreate: jest.Mock;
}> = {}) {
  const productTitleService = {
    findByExternalIdAndMarketplaceId: overrides.titleFind ?? jest.fn().mockResolvedValue(null),
    create: overrides.titleCreate ?? jest.fn(),
  };
  const mercadoLivreService = { getItem: overrides.getItem ?? jest.fn().mockResolvedValue({ status: 'active' }) };
  const productService = { findByBarcode: overrides.findByBarcode ?? jest.fn().mockResolvedValue(null) };
  const sut = new QuestionProductResolver(
    productTitleService as any, mercadoLivreService as any, productService as any,
  );
  return { sut, productTitleService, mercadoLivreService, productService };
}

describe('QuestionProductResolver', () => {
  it('returns productId from an exact Listing match without calling getItem', async () => {
    const pid = new Types.ObjectId();
    const { sut, mercadoLivreService } = makeSut({
      titleFind: jest.fn().mockResolvedValue({ product: { id: pid.toString() } }),
    });
    const result = await sut.resolve('MLB1', mkt, token);
    expect(result?.toString()).toBe(pid.toString());
    expect(mercadoLivreService.getItem).not.toHaveBeenCalled();
  });

  it('positive cache: second resolve does not re-query the title service', async () => {
    const pid = new Types.ObjectId();
    const titleFind = jest.fn().mockResolvedValue({ product: { id: pid.toString() } });
    const { sut } = makeSut({ titleFind });
    await sut.resolve('MLB1', mkt, token);
    await sut.resolve('MLB1', mkt, token);
    expect(titleFind).toHaveBeenCalledTimes(1);
  });

  it('negative cache: a miss is not re-fetched via getItem within TTL', async () => {
    const getItem = jest.fn().mockResolvedValue({ status: 'active' }); // no SKU → no match
    const { sut } = makeSut({ getItem });
    const first = await sut.resolve('MLB_MISS', mkt, token);
    const second = await sut.resolve('MLB_MISS', mkt, token);
    expect(first).toBeNull();
    expect(second).toBeNull();
    expect(getItem).toHaveBeenCalledTimes(1); // second served by negative cache
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/questions/resolve/question-product.resolver.spec.ts --runInBand`
Expected: FAIL — "Cannot find module './question-product.resolver'".

- [ ] **Step 3: Write minimal implementation**

```typescript
// question-product.resolver.ts
import { Injectable, Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import { ProductTitleService } from '../../product/services/product-title.service';
import { MercadoLivreService } from '../../marketplace/services/mercado-livre.service';
import { ProductService } from '../../product/product.service';

const NEGATIVE_TTL_MS = 30 * 60 * 1000;

@Injectable()
export class QuestionProductResolver {
  private readonly logger = new Logger(QuestionProductResolver.name);
  private positive = new Map<string, string>();
  private negative = new Map<string, number>();

  constructor(
    private readonly productTitleService: ProductTitleService,
    private readonly mercadoLivreService: MercadoLivreService,
    private readonly productService: ProductService,
  ) {}

  async resolve(itemId: string, marketplace: any, token: string): Promise<Types.ObjectId | null> {
    if (!itemId) return null;
    const key = `${marketplace._id}:${itemId}`;

    const cached = this.positive.get(key);
    if (cached) return new Types.ObjectId(cached);

    const negExpiry = this.negative.get(key);
    if (negExpiry && negExpiry > Date.now()) return null;
    if (negExpiry) this.negative.delete(key);

    const resolved = await this.doResolve(itemId, marketplace, token);
    if (resolved) {
      this.positive.set(key, resolved.toString());
      return resolved;
    }
    this.negative.set(key, Date.now() + NEGATIVE_TTL_MS);
    return null;
  }

  /** Listing match → numeric/MLB fallback → getItem+SKU auto-link. Lifted from QuestionsService.resolveProductId. */
  private async doResolve(itemId: string, marketplace: any, token: string): Promise<Types.ObjectId | null> {
    let pm = await this.productTitleService.findByExternalIdAndMarketplaceId(itemId, marketplace._id);

    if (!pm) {
      const numericId = itemId.replace(/\D/g, '');
      if (numericId && numericId !== itemId) {
        pm = await this.productTitleService.findByExternalIdAndMarketplaceId(numericId, marketplace._id);
        if (!pm) {
          const mlbId = `MLB${numericId}`;
          if (mlbId !== itemId) {
            pm = await this.productTitleService.findByExternalIdAndMarketplaceId(mlbId, marketplace._id);
          }
        }
      }
    }

    if (!pm) {
      try {
        const itemDetails = await this.mercadoLivreService.getItem(itemId, token);
        const sku = itemDetails.seller_custom_field ||
          itemDetails.attributes?.find((a: any) => a.id === 'SELLER_SKU')?.value_name;
        if (sku) {
          const localProduct = await this.productService.findByBarcode(sku);
          if (localProduct) {
            pm = await this.productTitleService.create(String(localProduct._id), {
              marketplaceId: marketplace._id,
              externalId: itemId,
              syncStatus: itemDetails.status === 'active' ? 'synced' : 'paused',
              marketplaceData: {
                permalink: itemDetails.permalink,
                price: itemDetails.price,
                title: itemDetails.title,
              },
            });
          }
        }
      } catch (e) {
        this.logger.error(`[Resolve] Auto-Link failed for ${itemId}: ${(e as Error).message}`);
      }
    }

    if (pm?.product?.id) return new Types.ObjectId(pm.product.id);
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/questions/resolve/question-product.resolver.spec.ts --runInBand`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd backend && git add src/questions/resolve/ && git commit -m "feat(questions): QuestionProductResolver with positive + negative cache

Kills repeated getItem calls for items with no local product (measured 20x for one item).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `QuestionIngestService` — single entry-point

**Files:**
- Create: `backend/src/questions/ingest/question-ingest.service.ts`
- Test: `backend/src/questions/ingest/question-ingest.service.spec.ts`

**Interfaces:**
- Consumes: `decideQuestionAction` (Task 2), `QuestionProductResolver.resolve` (Task 3), `QuestionRepository` (existing), `MarketplaceRegistryService.findAll`, `MarketplaceAuthService.ensureValidToken`, `MercadoLivreAdapter.getQuestionById`, `EventEmitter2`, `NOTIFICATION_EVENTS.REQUESTED`.
- Produces: `QuestionIngestService.ingest(externalQuestionId, source?)`.

**Behavior:** Fetch the ML question by id (resolving the ML marketplace + token as `syncSingleQuestion` does today at `questions.service.ts:64-81`), map to existing/incoming views, call `decideQuestionAction`, then:
- `CREATE` → resolve product, create doc, emit notification (if UNANSWERED), set `notified=true`.
- `UPDATE_ANSWER` → set answer/status/dateAnswered/responseTimeMinutes, save.
- `LINK_PRODUCT` → resolve product; if found, set `product`+`itemId`, save.
- `RECOVER_NOTIFICATION` → re-emit the same notification, set `notified=true`, save.
- `SKIP` → no-op.

- [ ] **Step 1: Write the failing test**

```typescript
// question-ingest.service.spec.ts
import { Types } from 'mongoose';
import { QuestionIngestService } from './question-ingest.service';
import { NOTIFICATION_EVENTS } from '../../notifications/events/notification.events';

const mlMarketplace = { _id: new Types.ObjectId(), enabled: true, name: 'Mercado Livre' };

function makeSut(existing: any) {
  const repo = {
    findOne: jest.fn().mockResolvedValue(existing),
    create: jest.fn().mockResolvedValue({ status: 'UNANSWERED', save: jest.fn() }),
  };
  const registry = { findAll: jest.fn().mockResolvedValue([mlMarketplace]) };
  const auth = { ensureValidToken: jest.fn().mockResolvedValue({ accessToken: 'tok' }) };
  const adapter = {
    getQuestionById: jest.fn().mockResolvedValue({
      id: 99, item_id: 'MLB1', text: 'oi?', status: 'UNANSWERED',
      date_created: new Date().toISOString(), from: { id: 1, nickname: 'b' },
    }),
  };
  const resolver = { resolve: jest.fn().mockResolvedValue(new Types.ObjectId()) };
  const emitter = { emit: jest.fn() };
  const sut = new QuestionIngestService(
    repo as any, registry as any, auth as any, adapter as any, resolver as any, emitter as any,
  );
  return { sut, repo, emitter, resolver };
}

describe('QuestionIngestService', () => {
  it('CREATE: new question creates doc and emits notification', async () => {
    const { sut, repo, emitter } = makeSut(null);
    await sut.ingest('99', 'webhook');
    expect(repo.create).toHaveBeenCalled();
    expect(emitter.emit).toHaveBeenCalledWith(NOTIFICATION_EVENTS.REQUESTED, expect.objectContaining({
      type: 'question.received', aggregateId: '99',
    }));
  });

  it('SKIP: settled question does nothing', async () => {
    const { sut, repo, emitter } = makeSut({
      externalId: '99', status: 'ANSWERED', product: new Types.ObjectId(), notified: true,
      save: jest.fn(),
    });
    await sut.ingest('99', 'reconcile');
    expect(repo.create).not.toHaveBeenCalled();
    expect(emitter.emit).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/questions/ingest/question-ingest.service.spec.ts --runInBand`
Expected: FAIL — "Cannot find module './question-ingest.service'".

- [ ] **Step 3: Write minimal implementation**

```typescript
// question-ingest.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { QuestionRepository } from '../question.repository';
import { MarketplaceRegistryService } from '../../marketplace/services/marketplace-registry.service';
import { MarketplaceAuthService } from '../../marketplace/auth/services/marketplace-auth.service';
import { MercadoLivreAdapter } from '../../marketplace/adapters/mercado-livre/mercado-livre.adapter';
import { QuestionProductResolver } from '../resolve/question-product.resolver';
import { NOTIFICATION_EVENTS } from '../../notifications/events/notification.events';
import { decideQuestionAction, QuestionIngestSource } from './question-ingest.decision';

@Injectable()
export class QuestionIngestService {
  private readonly logger = new Logger(QuestionIngestService.name);

  constructor(
    private readonly questionRepository: QuestionRepository,
    private readonly marketplaceRegistry: MarketplaceRegistryService,
    private readonly marketplaceAuth: MarketplaceAuthService,
    private readonly mercadoLivreAdapter: MercadoLivreAdapter,
    private readonly resolver: QuestionProductResolver,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async ingest(externalQuestionId: string, source: QuestionIngestSource = 'webhook'): Promise<void> {
    const marketplaces = await this.marketplaceRegistry.findAll();
    const mkt = marketplaces.find((m: any) => m.enabled && m.name === 'Mercado Livre');
    if (!mkt) return;

    let token: string | undefined;
    try {
      const active = await this.marketplaceAuth.ensureValidToken(mkt._id);
      token = active?.accessToken;
    } catch { return; }
    if (!token) return;

    const q = await this.mercadoLivreAdapter.getQuestionById(token, externalQuestionId);
    if (!q) return;

    const existing = await this.questionRepository.findOne({ externalId: String(q.id) });
    const action = decideQuestionAction(
      existing
        ? { status: existing.status, product: existing.product, notified: (existing as any).notified }
        : null,
      { status: q.status, hasAnswer: !!q.answer },
    );
    this.logger.log(`[Ingest] question ${q.id} action=${action.kind} source=${source}`);

    switch (action.kind) {
      case 'SKIP':
        return;
      case 'UPDATE_ANSWER':
        existing!.answer = q.answer?.text ?? existing!.answer;
        existing!.status = 'ANSWERED';
        existing!.dateAnswered = q.answer ? new Date(q.answer.date_created) : new Date();
        existing!.responseTimeMinutes = q.answer
          ? Math.round((new Date(q.answer.date_created).getTime() - new Date(existing!.dateCreated).getTime()) / 60000)
          : existing!.responseTimeMinutes;
        await existing!.save();
        return;
      case 'LINK_PRODUCT': {
        const pid = await this.resolver.resolve(q.item_id, mkt, token);
        if (pid) {
          existing!.product = pid;
          existing!.itemId = q.item_id;
          await existing!.save();
        }
        return;
      }
      case 'RECOVER_NOTIFICATION':
        this.emitNotification(q);
        (existing as any).notified = true;
        await existing!.save();
        return;
      case 'CREATE': {
        const pid = await this.resolver.resolve(q.item_id, mkt, token);
        const status = q.status === 'ANSWERED' ? 'ANSWERED' : 'UNANSWERED';
        const created = await this.questionRepository.create({
          externalId: String(q.id),
          itemId: q.item_id,
          question: q.text,
          status,
          dateCreated: new Date(q.date_created),
          marketplaceId: mkt._id,
          product: pid,
          buyerId: String(q.from?.id),
          buyerName: q.from?.nickname || null,
          answer: q.answer ? q.answer.text : null,
          dateAnswered: q.answer ? new Date(q.answer.date_created) : null,
          responseTimeMinutes: q.answer
            ? Math.round((new Date(q.answer.date_created).getTime() - new Date(q.date_created).getTime()) / 60000)
            : null,
          notified: false,
        });
        if (status === 'UNANSWERED') {
          this.emitNotification(q);
          (created as any).notified = true;
          await created.save();
        }
        return;
      }
    }
  }

  private emitNotification(q: any): void {
    this.eventEmitter.emit(NOTIFICATION_EVENTS.REQUESTED, {
      type: 'question.received',
      aggregateType: 'question',
      aggregateId: String(q.id),
      title: 'Nova Pergunta!',
      body: `${(q.text ?? '').substring(0, 100)} - ${q.item_id}`,
      data: {
        actionRoute: '/(drawer)/questions',
        externalId: String(q.id),
        marketplace: 'mercadolivre',
      },
      channels: ['push', 'websocket', 'persist'],
      severity: 'info',
      deduplicationKey: `question:mercadolivre:${q.id}`,
      source: 'webhook',
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/questions/ingest/question-ingest.service.spec.ts --runInBand`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
cd backend && git add src/questions/ingest/question-ingest.service.ts src/questions/ingest/question-ingest.service.spec.ts && git commit -m "feat(questions): QuestionIngestService single entry-point

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Reconcile cursor helpers (pure)

**Files:**
- Create: `backend/src/questions/reconcile/question-reconcile-cursor.ts`
- Test: `backend/src/questions/reconcile/question-reconcile-cursor.spec.ts`

**Interfaces:**
- Produces: `QUESTION_RECONCILE`, `nextInterval`, `maxQuestionCursor`, `isStatusDivergent` (signatures in File Structure block). Cursor is keyed on `date_created` (ML questions have no `date_last_updated`).

- [ ] **Step 1: Write the failing test**

```typescript
// question-reconcile-cursor.spec.ts
import { QUESTION_RECONCILE, nextInterval, maxQuestionCursor, isStatusDivergent } from './question-reconcile-cursor';

describe('question-reconcile-cursor', () => {
  it('nextInterval doubles on clean run up to ceiling', () => {
    expect(nextInterval(QUESTION_RECONCILE.FLOOR_MS, true)).toBe(QUESTION_RECONCILE.FLOOR_MS * 2);
    expect(nextInterval(QUESTION_RECONCILE.CEILING_MS, true)).toBe(QUESTION_RECONCILE.CEILING_MS);
  });

  it('nextInterval resets to floor on a gap', () => {
    expect(nextInterval(QUESTION_RECONCILE.CEILING_MS, false)).toBe(QUESTION_RECONCILE.FLOOR_MS);
  });

  it('maxQuestionCursor returns fallback for empty delta', () => {
    const fb = new Date('2026-01-01T00:00:00Z');
    expect(maxQuestionCursor([], fb)).toBe(fb);
  });

  it('maxQuestionCursor returns the newest date_created', () => {
    const fb = new Date('2026-01-01T00:00:00Z');
    const out = maxQuestionCursor(
      [{ date_created: '2026-06-01T00:00:00Z' }, { date_created: '2026-06-10T00:00:00Z' }], fb,
    );
    expect(out.toISOString()).toBe('2026-06-10T00:00:00.000Z');
  });

  it('isStatusDivergent is case-insensitive', () => {
    expect(isStatusDivergent('UNANSWERED', 'unanswered')).toBe(false);
    expect(isStatusDivergent('UNANSWERED', 'ANSWERED')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/questions/reconcile/question-reconcile-cursor.spec.ts --runInBand`
Expected: FAIL — "Cannot find module './question-reconcile-cursor'".

- [ ] **Step 3: Write minimal implementation**

```typescript
// question-reconcile-cursor.ts
export const QUESTION_RECONCILE = {
  FLOOR_MS: 5 * 60 * 1000,
  CEILING_MS: 20 * 60 * 1000,
  BOOTSTRAP_WINDOW_MS: 7 * 24 * 60 * 60 * 1000,
};

export function nextInterval(current: number, cleanRun: boolean): number {
  if (!cleanRun) return QUESTION_RECONCILE.FLOOR_MS;
  return Math.min(current * 2, QUESTION_RECONCILE.CEILING_MS);
}

export function maxQuestionCursor(refs: Array<{ date_created: string }>, fallback: Date): Date {
  if (!refs.length) return fallback;
  return refs.reduce((acc, r) => {
    const d = new Date(r.date_created);
    return d > acc ? d : acc;
  }, new Date(0));
}

export function isStatusDivergent(local?: string, external?: string): boolean {
  return (local ?? '').toLowerCase() !== (external ?? '').toLowerCase();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/questions/reconcile/question-reconcile-cursor.spec.ts --runInBand`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
cd backend && git add src/questions/reconcile/question-reconcile-cursor.ts src/questions/reconcile/question-reconcile-cursor.spec.ts && git commit -m "feat(questions): reconcile cursor helpers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Reconcile checkpoint schema + adapter delta method

**Files:**
- Create: `backend/src/questions/reconcile/question-reconcile-checkpoint.schema.ts`
- Modify: `backend/src/marketplace/adapters/mercado-livre/mercado-livre.adapter.ts` (replace `getQuestions` with `listQuestionsSince`)

**Interfaces:**
- Produces: `QuestionReconcileCheckpointModel` (collection `question_reconcile_checkpoints`); `MercadoLivreAdapter.listQuestionsSince(token, sellerId, since): Promise<Array<{ id, item_id, status, date_created }>>`.
- Consumes (caller note): nothing depends on the removed `getQuestions` after Task 8.

- [ ] **Step 1: Create the checkpoint schema**

```typescript
// question-reconcile-checkpoint.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type QuestionReconcileCheckpointDocument = HydratedDocument<QuestionReconcileCheckpointModel>;

@Schema({ collection: 'question_reconcile_checkpoints', timestamps: true })
export class QuestionReconcileCheckpointModel {
  @Prop({ required: true, unique: true })
  marketplaceId: string;

  @Prop({ required: true })
  lastCreatedCursor: Date;

  @Prop()
  lastRunAt: Date;

  @Prop({ default: 0 })
  consecutiveCleanRuns: number;

  @Prop({ default: 5 * 60 * 1000 })
  currentIntervalMs: number;
}

export const QuestionReconcileCheckpointSchema = SchemaFactory.createForClass(QuestionReconcileCheckpointModel);
```

- [ ] **Step 2: Replace `getQuestions` with `listQuestionsSince` in the adapter**

In `mercado-livre.adapter.ts`, replace the entire `getQuestions(...)` method (lines ~248-292) with:

```typescript
  /** Delta poll: newest-first questions, stopping once we pass `since`. Returns refs for the reconciler. */
  async listQuestionsSince(
    accessToken: string,
    sellerId: string,
    since: Date,
  ): Promise<Array<{ id: string; item_id: string; status: string; date_created: string }>> {
    const out: Array<{ id: string; item_id: string; status: string; date_created: string }> = [];
    const limit = 50;
    const HARD_CAP = 500; // safety bound
    let offset = 0;

    try {
      while (offset < HARD_CAP) {
        const response = await axios.get(
          `${this.baseUrl}/questions/search?seller_id=${sellerId}&sort_fields=item_id,date_created&api_version=4`,
          {
            params: { sort: 'date_created_desc', limit, offset },
            headers: { Authorization: `Bearer ${accessToken}` },
          },
        );
        const page = response.data.questions || [];
        if (page.length === 0) break;

        let crossedCursor = false;
        for (const q of page) {
          if (new Date(q.date_created) <= since) { crossedCursor = true; break; }
          out.push({ id: String(q.id), item_id: q.item_id, status: q.status, date_created: q.date_created });
        }
        if (crossedCursor || page.length < limit) break;
        offset += limit;
      }
      this.logger.log(`[Reconcile] ${out.length} ML questions newer than ${since.toISOString()}`);
      return out;
    } catch (error) {
      this.logger.error(`Erro ao listar perguntas (delta): ${error.message}`);
      throw error;
    }
  }
```

- [ ] **Step 3: Build check**

Run: `cd backend && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "mercado-livre.adapter|question-reconcile-checkpoint" || echo "no errors in touched files"`
Expected: `no errors in touched files`. (Errors elsewhere referencing the removed `getQuestions` are fixed in Task 8 — if `tsc` flags `questions.service.ts` here, that's expected and resolved in Task 8.)

- [ ] **Step 4: Commit**

```bash
cd backend && git add src/questions/reconcile/question-reconcile-checkpoint.schema.ts src/marketplace/adapters/mercado-livre/mercado-livre.adapter.ts && git commit -m "feat(questions): reconcile checkpoint schema + ML delta listQuestionsSince

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: `QuestionReconciler` adaptive delta poller

**Files:**
- Create: `backend/src/questions/reconcile/question-reconciler.service.ts`

**Interfaces:**
- Consumes: `QuestionReconcileCheckpointModel` (Task 6), `MercadoLivreAdapter.listQuestionsSince` (Task 6), `QuestionIngestService.ingest` (Task 4), `QuestionRepository`, `MarketplaceRegistryService`, `MarketplaceAuthService`, cursor helpers (Task 5).
- Produces: a self-scheduling `OnModuleInit` service (no public API beyond `runFor`).

**Behavior:** Mirror `OrderReconciler`: on init, schedule per enabled ML marketplace. Each run resolves the seller token, lists questions since the cursor, and for each ref whose local copy is missing or status-divergent, calls `ingest(ref.id, 'reconcile')`. Adaptive interval via cursor helpers. Gated by `QUESTION_RECONCILER_ENABLED !== 'false'`.

- [ ] **Step 1: Write the implementation** (no unit test — this is thin orchestration over already-tested units; covered by manual verification in Task 9)

```typescript
// question-reconciler.service.ts
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  QuestionReconcileCheckpointModel,
  QuestionReconcileCheckpointDocument,
} from './question-reconcile-checkpoint.schema';
import { MercadoLivreAdapter } from '../../marketplace/adapters/mercado-livre/mercado-livre.adapter';
import { MarketplaceRegistryService } from '../../marketplace/services/marketplace-registry.service';
import { MarketplaceAuthService } from '../../marketplace/auth/services/marketplace-auth.service';
import { QuestionRepository } from '../question.repository';
import { QuestionIngestService } from '../ingest/question-ingest.service';
import { QUESTION_RECONCILE, nextInterval, maxQuestionCursor, isStatusDivergent } from './question-reconcile-cursor';

@Injectable()
export class QuestionReconciler implements OnModuleInit {
  private readonly logger = new Logger(QuestionReconciler.name);
  private timers = new Map<string, NodeJS.Timeout>();

  constructor(
    @InjectModel(QuestionReconcileCheckpointModel.name)
    private readonly checkpoints: Model<QuestionReconcileCheckpointDocument>,
    private readonly adapter: MercadoLivreAdapter,
    private readonly registry: MarketplaceRegistryService,
    private readonly auth: MarketplaceAuthService,
    private readonly repo: QuestionRepository,
    private readonly ingest: QuestionIngestService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env.QUESTION_RECONCILER_ENABLED === 'false') {
      this.logger.log('[QReconcile] disabled via QUESTION_RECONCILER_ENABLED=false');
      return;
    }
    const marketplaces = await this.registry.findAll();
    for (const mkt of marketplaces.filter((m: any) => m.enabled && m.name === 'Mercado Livre')) {
      this.scheduleNext(String(mkt._id), QUESTION_RECONCILE.FLOOR_MS);
    }
  }

  private scheduleNext(marketplaceId: string, delay: number): void {
    const t = setTimeout(
      () => this.runFor(marketplaceId).catch(e =>
        this.logger.error(`[QReconcile] ${marketplaceId} failed: ${(e as Error).message}`),
      ),
      delay,
    );
    this.timers.set(marketplaceId, t);
  }

  async runFor(marketplaceId: string): Promise<void> {
    const cp = await this.getOrCreateCheckpoint(marketplaceId);

    const mkt = (await this.registry.findAll()).find((m: any) => String(m._id) === marketplaceId);
    let sellerId: string | undefined;
    let token: string | undefined;
    try {
      const active = await this.auth.ensureValidToken(mkt._id);
      token = active?.accessToken;
      sellerId = active?.additionalData?.userId;
    } catch (e) {
      this.logger.warn(`[QReconcile] ${marketplaceId} token unavailable: ${(e as Error).message}`);
    }

    let refs: Array<{ id: string; item_id: string; status: string; date_created: string }> = [];
    if (token && sellerId) {
      refs = await this.adapter.listQuestionsSince(token, sellerId, cp.lastCreatedCursor);
    }

    let gaps = 0;
    for (const ref of refs) {
      const existing = await this.repo.findOne({ externalId: ref.id });
      if (!existing || isStatusDivergent(existing.status, ref.status)) {
        gaps++;
        await this.ingest.ingest(ref.id, 'reconcile');
      }
    }

    const cleanRun = gaps === 0;
    cp.lastCreatedCursor = maxQuestionCursor(refs, cp.lastCreatedCursor);
    cp.lastRunAt = new Date();
    cp.consecutiveCleanRuns = cleanRun ? cp.consecutiveCleanRuns + 1 : 0;
    cp.currentIntervalMs = nextInterval(cp.currentIntervalMs, cleanRun);
    await cp.save();

    this.logger.log(`[QReconcile] ${marketplaceId} delta=${refs.length} gaps=${gaps} nextMs=${cp.currentIntervalMs}`);
    this.scheduleNext(marketplaceId, cp.currentIntervalMs);
  }

  private async getOrCreateCheckpoint(marketplaceId: string): Promise<QuestionReconcileCheckpointDocument> {
    const existing = await this.checkpoints.findOne({ marketplaceId });
    if (existing) return existing;
    return this.checkpoints.create({
      marketplaceId,
      lastCreatedCursor: new Date(Date.now() - QUESTION_RECONCILE.BOOTSTRAP_WINDOW_MS),
      currentIntervalMs: QUESTION_RECONCILE.FLOOR_MS,
      consecutiveCleanRuns: 0,
    });
  }
}
```

- [ ] **Step 2: Build check**

Run: `cd backend && npx tsc --noEmit -p tsconfig.json 2>&1 | grep "question-reconciler" || echo "no errors in question-reconciler"`
Expected: `no errors in question-reconciler`.

- [ ] **Step 3: Commit**

```bash
cd backend && git add src/questions/reconcile/question-reconciler.service.ts && git commit -m "feat(questions): QuestionReconciler adaptive delta poller

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Wire module + strip legacy from QuestionsService/controller/scheduler

**Files:**
- Modify: `backend/src/questions/questions.module.ts`
- Modify: `backend/src/questions/questions.service.ts`
- Modify: `backend/src/questions/questions.controller.ts`
- Modify: `backend/src/scheduler/scheduler.service.ts`

**Interfaces:**
- Consumes: all providers from Tasks 2-7.
- Produces: a wired module; `QuestionsService` retains only `findAll`, `getStats`, `getAiSuggestion`, `answerQuestion`. The webhook listeners move to `QuestionIngestService`-backed handlers.

- [ ] **Step 1: Register providers + checkpoint schema in `questions.module.ts`**

Replace the `@Module({...})` imports/providers so it includes:

```typescript
import { QuestionIngestService } from './ingest/question-ingest.service';
import { QuestionProductResolver } from './resolve/question-product.resolver';
import { QuestionReconciler } from './reconcile/question-reconciler.service';
import {
  QuestionReconcileCheckpointModel,
  QuestionReconcileCheckpointSchema,
} from './reconcile/question-reconcile-checkpoint.schema';
```

Add to `MongooseModule.forFeature([...])`:

```typescript
      { name: QuestionReconcileCheckpointModel.name, schema: QuestionReconcileCheckpointSchema },
```

Add to `providers`:

```typescript
        QuestionIngestService, QuestionProductResolver, QuestionReconciler,
```

Add to `exports`:

```typescript
        QuestionIngestService,
```

- [ ] **Step 2: Move webhook handlers into `QuestionsService` delegating to ingest, and delete legacy methods**

In `questions.service.ts`:
- Inject `QuestionIngestService` (constructor) and **remove** the now-unused injections: `mercadoLivreAdapter`, `mercadoLivreService`, `productTitleService`, `productService` (keep `questionRepository`, `marketplaceRegistry`, `marketplaceAuth`, `productCompatibilityService`, `aiService`, `eventEmitter` only if still used by the retained methods — `marketplaceRegistry`/`marketplaceAuth` ARE still used by `answerQuestion`).
- Replace both webhook handlers' bodies to delegate:

```typescript
  @OnEvent(WEBHOOK_DOMAIN_COMMANDS.QUESTION_INGEST_REQUESTED, { async: true })
  async handleQuestionIngestRequested(event: QuestionIngestRequestedCommand): Promise<void> {
    this.logger.log(`[Webhook] Question ingest requested ${event.marketplace}/${event.externalQuestionId}`);
    await this.questionIngest.ingest(event.externalQuestionId, 'webhook');
  }

  @OnEvent('question.sync_requested', { async: true })
  async handleLegacyQuestionWebhook(event: { marketplace: string; payload: any }): Promise<void> {
    const resourceId = event.payload?.resource?.split('/').pop();
    if (resourceId && event.marketplace === 'mercadolivre') {
      await this.questionIngest.ingest(resourceId, 'webhook');
    }
  }
```

- **Delete** these methods entirely: `syncSingleQuestion`, `upsertQuestion`, `resolveProductId`, `syncQuestions`, `syncMercadoLivreQuestions`.
- Remove now-unused imports (`Types`, `MercadoLivreAdapter`, `MercadoLivreService`, `ProductService`, `ProductTitleService`, `NOTIFICATION_EVENTS`).

- [ ] **Step 3: Remove `POST /questions/sync` from the controller**

In `questions.controller.ts`, delete the entire `@Post('sync') async sync() {...}` method.

- [ ] **Step 4: Remove the question cron from the scheduler**

In `scheduler.service.ts`:
- Delete the `handleQuestionSync()` method (the `@Cron('0 */5 * * * *')` block).
- Remove the `QuestionsService` import and its constructor injection (`@Inject(forwardRef(() => QuestionsService)) private readonly questionsService`).

- [ ] **Step 5: Build check**

Run: `cd backend && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "questions|scheduler" || echo "clean"`
Expected: `clean` (no dangling references to removed methods).

- [ ] **Step 6: Run the full questions test suite**

Run: `cd backend && npx jest src/questions --runInBand`
Expected: PASS (all specs from Tasks 2-5).

- [ ] **Step 7: Commit**

```bash
cd backend && git add src/questions/questions.module.ts src/questions/questions.service.ts src/questions/questions.controller.ts src/scheduler/scheduler.service.ts && git commit -m "refactor(questions): wire ingest+reconciler, remove full-scan path

Removes syncQuestions full-scan, POST /sync, and the 5-min cron. Webhook + reconciler now feed a single QuestionIngestService.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: End-to-end verification (boot + reconciler smoke)

**Files:** none (verification only).

- [ ] **Step 1: Boot the app to confirm DI graph resolves**

Run: `cd backend && QUESTION_RECONCILER_ENABLED=false npm run start:dev` (let it reach "Nest application successfully started", then Ctrl-C).
Expected: no `Nest can't resolve dependencies` errors for `QuestionIngestService`, `QuestionProductResolver`, or `QuestionReconciler`. Reconciler logs that it is disabled.

- [ ] **Step 2: Boot with reconciler enabled and observe one cycle**

Run: `cd backend && npm run start:dev` and watch logs for ~6 minutes (FLOOR_MS = 5 min).
Expected: a `[QReconcile] <marketplaceId> delta=N gaps=M nextMs=...` line appears. On a clean run, `nextMs` doubles toward the 20-min ceiling.

- [ ] **Step 3: Confirm the negative cache holds**

In the same boot, if any item with no local product is encountered twice in the delta, confirm only one `[Resolve] Auto-Link failed`/`getItem` per item per TTL window. (Optional: re-run `scripts/measure-question-product-coverage.ts` later to confirm the "questions per distinct item" ratio no longer drives repeated API calls.)

- [ ] **Step 4: Delete the diagnostic script (optional cleanup)**

The measurement script `scripts/measure-question-product-coverage.ts` was a one-off. Keep it if useful as a recurring health check, or remove:

```bash
cd backend && git rm scripts/measure-question-product-coverage.ts && git commit -m "chore(questions): remove one-off coverage diagnostic

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review Notes

- **Spec coverage:** single ingest (Task 4) ✓; pure decision (Task 2) ✓; reconciler delta replacing full-scan (Tasks 5-7) ✓; full-scan/POST/cron removal (Task 8) ✓; product resolution with negative cache (Task 3) ✓; notification parity incl. RECOVER_NOTIFICATION (Tasks 1, 4) ✓; orphan items persist+notify with `product=null` (Task 4 CREATE path) ✓.
- **Type consistency:** `QuestionAction` kinds, `QuestionIngestSource`, `resolve()` and `ingest()` signatures, and cursor helper names are used identically across Tasks 2-8.
- **No placeholders:** every code step shows full code; every run step shows command + expected output.
- **Known nuance:** `LINK_PRODUCT` (Task 2) is a refinement over Orders — Questions can acquire a product link on a later pass because the ML payload only carries `item_id`. This is intentional and data-justified (92% link rate, 7.8% deferred).
```
