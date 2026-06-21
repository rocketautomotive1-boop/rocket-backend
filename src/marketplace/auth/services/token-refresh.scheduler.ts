import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { OnEvent } from '@nestjs/event-emitter';
import {
    MarketplaceTokenBrokerService,
    TOKEN_SAVED_EVENT,
    TokenSavedEvent,
} from './marketplace-token-broker.service';

/**
 * Refresh proativo de tokens OAuth, event-driven (self-scheduling).
 *
 * Em vez de varrer todas as contas a cada N minutos (cron), agenda UM timer por
 * token para `expiresAt - buffer`. O `expiresAt` que já vive em accounts[] é a
 * fonte de verdade durável; o timer in-memory é só uma projeção descartável dele.
 *
 * Ciclo auto-perpetuado: todo token novo passa por saveAccountToken → emite
 * TOKEN_SAVED_EVENT → reagenda. Refresh bem-sucedido grava novo expiresAt → novo
 * evento → próximo timer. Conta nova/re-auth entra no relógio automaticamente.
 *
 * Restart: onModuleInit rehidrata a partir do Mongo (timers in-memory são perdidos,
 * mas expiresAt não). Complementa o lazy refresh do ensureValidToken — cobre o furo
 * de contas idle cujo refresh_token expiraria sem nunca ter sido usado.
 */
@Injectable()
export class TokenRefreshScheduler implements OnModuleInit {
    private readonly logger = new Logger(TokenRefreshScheduler.name);
    private readonly bufferMinutes = 30;

    constructor(
        private readonly tokenBroker: MarketplaceTokenBrokerService,
        private readonly schedulerRegistry: SchedulerRegistry,
    ) {}

    /** Rehidratação no boot: reconstrói um timer por token agendável. */
    async onModuleInit(): Promise<void> {
        try {
            const tokens = await this.tokenBroker.listSchedulableTokens();
            for (const t of tokens) this.schedule(t.marketplaceId, t.accountId, t.expiresAt);
            this.logger.log(`Token refresh rehydrated: ${tokens.length} timer(s) scheduled.`);
        } catch (error) {
            this.logger.error('Error rehydrating token refresh timers:', error);
        }
    }

    /** Reagenda sempre que um token é salvo (refresh, callback OAuth, registro). */
    @OnEvent(TOKEN_SAVED_EVENT)
    onTokenSaved(event: TokenSavedEvent): void {
        this.schedule(event.marketplaceId, event.accountId, event.expiresAt);
    }

    /**
     * Agenda (ou substitui) o timer de refresh de um token. Idempotente por
     * (marketplaceId, accountId). Tokens sem expiresAt não agendam — o lazy
     * refresh os cobre sob demanda.
     */
    private schedule(marketplaceId: string, accountId: string, expiresAt?: Date | null): void {
        const name = this.timerName(marketplaceId, accountId);
        this.clearExisting(name);
        if (!expiresAt) return;

        const fireAt = new Date(expiresAt).getTime() - this.bufferMinutes * 60 * 1000;
        const delay = Math.max(0, fireAt - Date.now());

        const timer = setTimeout(() => this.fire(marketplaceId, accountId), delay);
        this.schedulerRegistry.addTimeout(name, timer);
    }

    private async fire(marketplaceId: string, accountId: string): Promise<void> {
        const name = this.timerName(marketplaceId, accountId);
        // O timer disparou; remove o registro antes de renovar. O refresh bem-sucedido
        // emite TOKEN_SAVED_EVENT e reagenda o próximo. Falha (ex.: refresh_token
        // revogado) não reagenda — exige re-auth manual, sem retry-storm.
        this.clearExisting(name);
        try {
            await this.tokenBroker.refreshToken(marketplaceId, accountId);
        } catch (error: any) {
            this.logger.warn(
                `Proactive refresh failed for account ${accountId} (mp ${marketplaceId}): ${error?.message}`,
            );
        }
    }

    private clearExisting(name: string): void {
        if (this.schedulerRegistry.doesExist('timeout', name)) {
            this.schedulerRegistry.deleteTimeout(name);
        }
    }

    private timerName(marketplaceId: string, accountId: string): string {
        return `refresh:${marketplaceId}:${accountId}`;
    }
}
