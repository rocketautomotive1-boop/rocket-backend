# Sync Result WebSocket Real-Time Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Push sync results (success/failure) from the orchestrator to the frontend in real-time via WebSocket, so the "publicando..." banner clears immediately when the listing is created/updated.

**Architecture:** The orchestrator's `SuccessHandler` already publishes to `rocket.marketplace.results`. The backend adds a RabbitMQ consumer that (1) updates `listing.externalId` + `listing.status` in MongoDB and (2) emits a `sync.completed` WebSocket event via a new `/sync` namespace gateway. The frontend's `ProductPublicationIssuesContext` connects to `/sync` when `categoryResolutionPending` is true, listens for `sync.completed` for the current productId, and invalidates the issues query immediately.

**Tech Stack:** NestJS, `@golevelup/nestjs-rabbitmq` (`@RabbitSubscribe`), Socket.IO (`@nestjs/websockets`), `socket.io-client` (React Native frontend), TanStack Query.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `backend/src/gateways/sync.gateway.ts` | **Create** | WebSocket gateway `/sync` — emits `sync.completed` and `sync.failed` per productId |
| `backend/src/marketplace-orchestrator/sync-result.consumer.ts` | **Create** | RabbitMQ consumer for `rocket.marketplace.results` — updates listing in MongoDB, calls gateway |
| `backend/src/gateways/gateways.module.ts` | Modify | Register `SyncGateway` |
| `backend/src/marketplace-orchestrator/marketplace-orchestrator.module.ts` | Modify | Register `SyncResultConsumer`, inject `SyncGateway` |
| `frontend/src/contexts/ProductPublicationIssuesContext.tsx` | Modify | Connect to `/sync` when `categoryResolutionPending`, listen for `sync.completed` → invalidate query |

---

## Task 1: Create SyncGateway — WebSocket `/sync` namespace

**Files:**
- Create: `backend/src/gateways/sync.gateway.ts`

The gateway follows the same pattern as `discovery.gateway.ts`. Clients join a room `product_{productId}` and receive `sync.completed` or `sync.failed` events.

- [ ] **Step 1: Create the file**

```typescript
import {
    WebSocketGateway,
    WebSocketServer,
    SubscribeMessage,
    MessageBody,
    ConnectedSocket,
    OnGatewayConnection,
    OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Injectable, Logger } from '@nestjs/common';
import { Namespace, Socket } from 'socket.io';

export interface SyncCompletedEvent {
    productId: string;
    listingId: string;
    externalId: string;
    marketplaceTag: string;
    success: true;
}

export interface SyncFailedEvent {
    productId: string;
    listingId: string;
    errorMessage: string;
    errorClassifier?: string;
    marketplaceTag: string;
    success: false;
}

@Injectable()
@WebSocketGateway({
    namespace: '/sync',
    cors: { origin: '*', methods: ['GET', 'POST'], credentials: true },
    transports: ['websocket', 'polling'],
})
export class SyncGateway implements OnGatewayConnection, OnGatewayDisconnect {
    private readonly logger = new Logger(SyncGateway.name);

    @WebSocketServer()
    server: Namespace;

    handleConnection(client: Socket) {
        this.logger.debug(`Sync client connected: ${client.id}`);
    }

    handleDisconnect(client: Socket) {
        this.logger.debug(`Sync client disconnected: ${client.id}`);
    }

    @SubscribeMessage('subscribeToProduct')
    handleSubscribe(
        @MessageBody() data: { productId: string },
        @ConnectedSocket() client: Socket,
    ) {
        if (!data?.productId) return;
        client.join(`product_${data.productId}`);
        client.emit('subscribed', { productId: data.productId });
        this.logger.debug(`Client ${client.id} subscribed to product ${data.productId}`);
    }

    emitSyncCompleted(event: SyncCompletedEvent): void {
        const room = `product_${event.productId}`;
        const size = this.server.adapter?.rooms?.get(room)?.size ?? 0;
        if (size === 0) return;
        this.logger.log(`Emitting sync.completed for product ${event.productId} (${size} subscribers)`);
        this.server.to(room).emit('sync.completed', event);
    }

    emitSyncFailed(event: SyncFailedEvent): void {
        const room = `product_${event.productId}`;
        const size = this.server.adapter?.rooms?.get(room)?.size ?? 0;
        if (size === 0) return;
        this.logger.warn(`Emitting sync.failed for product ${event.productId} (${size} subscribers)`);
        this.server.to(room).emit('sync.failed', event);
    }
}
```

- [ ] **Step 2: Commit**

```bash
cd backend
git add src/gateways/sync.gateway.ts
git commit -m "feat(backend): SyncGateway WebSocket /sync namespace"
```

---

## Task 2: Register SyncGateway in GatewaysModule

**Files:**
- Modify: `backend/src/gateways/gateways.module.ts`

- [ ] **Step 1: Add SyncGateway to providers and exports**

```typescript
import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { MongooseModule } from '@nestjs/mongoose';
import { DiscoveryGateway } from './discovery.gateway';
import { OrderGateway } from './order.gateway';
import { RembgGateway } from './rembg.gateway';
import { SyncGateway } from './sync.gateway';
import { RembgController } from './rembg.controller';
import { ProcessedImage, ProcessedImageSchema } from './schemas/processed-image.schema';
import { ProcessedImageService } from './processed-image.service';
import { RembgJob, RembgJobSchema } from './schemas/rembg-job.schema';
import { RembgEnqueueService } from './rembg-enqueue.service';
import { RembgJobConsumer } from './rembg-job.consumer';
import { S3Module } from '../common/s3/s3.module';
import { AuthModule } from '../auth/auth.module';
import { ProductDiscoveryModel, ProductDiscoverySchema } from '../product/schemas/product-discovery.schema';

@Module({
    imports: [
        MulterModule.register({ limits: { fileSize: 100 * 1024 * 1024 } }),
        MongooseModule.forFeature([
            { name: ProcessedImage.name, schema: ProcessedImageSchema },
            { name: RembgJob.name, schema: RembgJobSchema },
            { name: ProductDiscoveryModel.name, schema: ProductDiscoverySchema },
        ]),
        S3Module,
        AuthModule,
    ],
    controllers: [RembgController],
    providers: [
        DiscoveryGateway,
        OrderGateway,
        RembgGateway,
        SyncGateway,
        ProcessedImageService,
        RembgEnqueueService,
        RembgJobConsumer,
    ],
    exports: [DiscoveryGateway, OrderGateway, RembgGateway, SyncGateway, ProcessedImageService, RembgEnqueueService],
})
export class GatewaysModule {}
```

- [ ] **Step 2: Commit**

```bash
git add src/gateways/gateways.module.ts
git commit -m "feat(backend): register SyncGateway in GatewaysModule"
```

---

## Task 3: Create SyncResultConsumer — RabbitMQ consumer + listing update

**Files:**
- Create: `backend/src/marketplace-orchestrator/sync-result.consumer.ts`

This consumer listens to `rocket.marketplace.results` (routing key `result.*`), updates the listing in MongoDB with `externalId` and `status: 'active'`, then calls `SyncGateway` to push the real-time event.

The queue `q.sync.results` is already declared in the backend's RabbitMQ module. The consumer just needs to register a handler on it.

- [ ] **Step 1: Create the consumer**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ListingModel } from '../listing/schemas/listing.schema';
import { SyncGateway } from '../gateways/sync.gateway';

interface SyncResultMessage {
    syncRequestId: string;
    listingId: string;
    productId: string;
    marketplaceId: string;
    marketplaceTag?: string;
    success: boolean;
    externalId?: string;
    errorMessage?: string;
    errorClassifier?: string;
    processedAt?: string;
}

@Injectable()
export class SyncResultConsumer {
    private readonly logger = new Logger(SyncResultConsumer.name);

    constructor(
        @InjectModel(ListingModel.name) private readonly listingModel: Model<ListingModel>,
        private readonly syncGateway: SyncGateway,
    ) {}

    @RabbitSubscribe({
        exchange: 'rocket.marketplace.results',
        routingKey: 'result.*',
        queue: 'q.sync.results',
        queueOptions: { durable: true },
    })
    async handle(msg: SyncResultMessage): Promise<void> {
        this.logger.log(
            `Sync result received: listing=${msg.listingId} success=${msg.success} externalId=${msg.externalId}`,
        );

        const marketplaceTag = msg.marketplaceTag ?? String(msg.marketplaceId);

        if (msg.success && msg.externalId) {
            await this.listingModel.findByIdAndUpdate(msg.listingId, {
                $set: {
                    externalId: msg.externalId,
                    status: 'active',
                    synchronized: true,
                    errorMessage: null,
                    lastSyncAt: new Date(),
                    publishingAt: null,
                    'marketplaceData.syncIssue': null,
                    'marketplaceData.recreateRequired': false,
                },
            });

            this.syncGateway.emitSyncCompleted({
                productId: String(msg.productId),
                listingId: String(msg.listingId),
                externalId: msg.externalId,
                marketplaceTag,
                success: true,
            });
        } else if (!msg.success) {
            await this.listingModel.findByIdAndUpdate(msg.listingId, {
                $set: {
                    status: 'error',
                    errorMessage: msg.errorMessage ?? 'Sync failed',
                    synchronized: false,
                    lastSyncAt: new Date(),
                    publishingAt: null,
                },
            });

            this.syncGateway.emitSyncFailed({
                productId: String(msg.productId),
                listingId: String(msg.listingId),
                errorMessage: msg.errorMessage ?? 'Sync failed',
                errorClassifier: msg.errorClassifier,
                marketplaceTag,
                success: false,
            });
        }
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/marketplace-orchestrator/sync-result.consumer.ts
git commit -m "feat(backend): SyncResultConsumer — updates listing + emits WebSocket on sync result"
```

---

## Task 4: Register SyncResultConsumer in MarketplaceOrchestratorModule

**Files:**
- Modify: `backend/src/marketplace-orchestrator/marketplace-orchestrator.module.ts`

- [ ] **Step 1: Add imports and registration**

Add `GatewaysModule` to imports, `SyncResultConsumer` to providers:

```typescript
import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RabbitMqModule } from '../common/rabbitmq/rabbitmq.module';
import { MarketplaceAuthModule } from '../marketplace/auth/marketplace-auth.module';
import { AuthModule } from '../auth/auth.module';
import { GatewaysModule } from '../gateways/gateways.module';

import { ListingRemovalService } from './services/listing-removal.service';
import { OLXReconciliationService } from './services/olx-reconciliation.service';
import { MarketplaceIssuesService } from './services/marketplace-issues.service';
import { PublicationFlowService } from './services/publication-flow.service';
import { OperationalIssuesService } from './services/operational-issues.service';
import { OrchestratorPublisherService } from './orchestrator-publisher.service';
import { SyncResultConsumer } from './sync-result.consumer';

import { CategoryModel, CategorySchema } from '../product/schemas/category.schema';
import { MarketplaceModel, MarketplaceSchema } from '../marketplace/schemas/marketplace.schema';
import { ListingModel, ListingSchema } from '../listing/schemas/listing.schema';
import { ProductModel, ProductSchema } from '../product/schemas/product.schema';
import { StockMovementModel, StockMovementSchema } from '../product/schemas/stock-movement.schema';

import { MarketplaceOrchestratorController } from './marketplace-orchestrator.controller';
import { PublicationLogService } from '../marketplace/services/publication-log.service';
import { PublicationAttempt, PublicationAttemptSchema } from '../marketplace/schemas/publication-attempt.schema';
import { UserProductivityModule } from '../monitoring/user-productivity.module';
import { ProductRepository } from '../product/product.repository';
import { ProductCompatibilityModel, ProductCompatibilitySchema } from '../product/schemas/product-compatibility.schema';
import { ProductModule } from '../product/product.module';

@Module({
    imports: [
        RabbitMqModule,
        MarketplaceAuthModule,
        AuthModule,
        GatewaysModule,
        forwardRef(() => ProductModule),
        MongooseModule.forFeature([
            { name: MarketplaceModel.name, schema: MarketplaceSchema },
            { name: ListingModel.name, schema: ListingSchema },
            { name: PublicationAttempt.name, schema: PublicationAttemptSchema },
            { name: CategoryModel.name, schema: CategorySchema },
            { name: ProductCompatibilityModel.name, schema: ProductCompatibilitySchema },
            { name: ProductModel.name, schema: ProductSchema },
            { name: StockMovementModel.name, schema: StockMovementSchema },
        ]),
        UserProductivityModule,
    ],
    controllers: [MarketplaceOrchestratorController],
    providers: [
        PublicationLogService,
        PublicationFlowService,
        ProductRepository,
        ListingRemovalService,
        OLXReconciliationService,
        MarketplaceIssuesService,
        OperationalIssuesService,
        OrchestratorPublisherService,
        SyncResultConsumer,
    ],
    exports: [
        ListingRemovalService,
        MarketplaceIssuesService,
        OperationalIssuesService,
        OrchestratorPublisherService,
    ],
})
export class MarketplaceOrchestratorModule {}
```

- [ ] **Step 2: Build to verify no TypeScript errors**

```bash
npm run build
```

Expected: build completes with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/marketplace-orchestrator/marketplace-orchestrator.module.ts
git commit -m "feat(backend): register SyncResultConsumer in MarketplaceOrchestratorModule"
```

---

## Task 5: Frontend — connect to /sync WebSocket in ProductPublicationIssuesContext

**Files:**
- Modify: `frontend/src/contexts/ProductPublicationIssuesContext.tsx`

When `categoryResolutionPending` is true and `productId` is set, connect to the backend's `/sync` WebSocket namespace, subscribe to `product_{productId}` room, and listen for `sync.completed` or `sync.failed`. On `sync.completed`, invalidate the `product-publication-issues` query immediately (which triggers a re-fetch and `rawHasWrongCategory` becomes false, auto-clearing `categoryResolutionPending`).

- [ ] **Step 1: Add socket.io-client import**

At the top of `src/contexts/ProductPublicationIssuesContext.tsx`, add:

```typescript
import { useQueryClient } from '@tanstack/react-query';
import { io, Socket } from 'socket.io-client';
import { getApiBaseUrl } from '../api';
```

> Note: `getApiBaseUrl` is a helper that returns the backend base URL (same URL used elsewhere in the app). Check `src/api/index.ts` for the correct export name — it may be `API_BASE_URL`, a constant, or a function. Use whatever the existing pattern is.

- [ ] **Step 2: Add useQueryClient inside provider**

Inside `ProductPublicationIssuesProvider`, add near the top:
```typescript
  const queryClient = useQueryClient();
```

- [ ] **Step 3: Add the WebSocket effect**

Add this `useEffect` inside `ProductPublicationIssuesProvider`, after the `categoryResolutionPending` state and `resolveWrongCategory` callback:

```typescript
  useEffect(() => {
    if (!categoryResolutionPending || !productId) return;

    const baseUrl = getApiBaseUrl(); // resolve to backend base URL
    const socket: Socket = io(`${baseUrl}/sync`, {
      transports: ['websocket'],
      extraHeaders: { 'ngrok-skip-browser-warning': 'true' },
    });

    socket.on('connect', () => {
      socket.emit('subscribeToProduct', { productId });
    });

    socket.on('sync.completed', (event: { productId: string }) => {
      if (event.productId !== productId) return;
      queryClient.invalidateQueries({ queryKey: ['product-publication-issues', productId] });
      queryClient.invalidateQueries({ queryKey: ['product-completion', productId] });
    });

    socket.on('sync.failed', (event: { productId: string }) => {
      if (event.productId !== productId) return;
      queryClient.invalidateQueries({ queryKey: ['product-publication-issues', productId] });
      queryClient.invalidateQueries({ queryKey: ['product-completion', productId] });
    });

    return () => {
      socket.disconnect();
    };
  }, [categoryResolutionPending, productId, queryClient]);
```

- [ ] **Step 4: Resolve the correct API base URL import**

Read `src/api/index.ts` to find the correct way to get the backend base URL. Common patterns:
- `export const API_BASE_URL = '...'`
- `const api = axios.create({ baseURL: ... })` — extract the baseURL
- `export function getApiBaseUrl() { ... }`

Replace `getApiBaseUrl()` in the effect with whatever the codebase uses. If `api` is an Axios instance, you can do `(api.defaults.baseURL || '').replace('/api', '')` or similar.

- [ ] **Step 5: Commit**

```bash
cd frontend
git add src/contexts/ProductPublicationIssuesContext.tsx
git commit -m "feat(frontend): connect to /sync WebSocket when categoryResolutionPending — real-time sync result"
```

---

## Task 6: Verify end-to-end

- [ ] **Step 1: Start all services**

```bash
# Terminal 1 — backend
cd backend && npm run start:dev

# Terminal 2 — orchestrator
cd microservices/orchestrator && npm run start:dev
```

Expected backend log on startup:
```
[SyncResultConsumer] Registered on rocket.marketplace.results → q.sync.results
```

- [ ] **Step 2: Trigger a sync for a product with wrong_category**

From the mobile app: enter the category section of a product that has wrong_category active. Select a new category. Tap "Salvar".

Expected sequence:
1. `categoryResolutionPending = true` → banner changes to amber "Categoria alterada — aguardando publicação"
2. Frontend connects to `/sync` WebSocket
3. Backend orchestrator creates the listing on ML
4. `SuccessHandler` publishes to `rocket.marketplace.results`
5. `SyncResultConsumer` receives → updates `listing.externalId` + `status: 'active'` in MongoDB
6. `SyncGateway.emitSyncCompleted` fires → frontend receives `sync.completed`
7. Frontend invalidates `product-publication-issues` query
8. Query re-fetches → `rawHasWrongCategory = false` → `categoryResolutionPending` auto-resets
9. Banner disappears, category card on dashboard returns to normal

- [ ] **Step 3: Verify listing in MongoDB**

After sync success, check the listing document:
- `status: 'active'`
- `externalId: 'MLB...'`
- `marketplaceData.syncIssue: null`

Expected via MongoDB Compass or shell:
```javascript
db.listings.findOne({ productId: ObjectId('...') }, { status: 1, externalId: 1 })
// { status: 'active', externalId: 'MLB4669209381' }
```
