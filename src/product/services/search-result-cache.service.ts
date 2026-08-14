import { Injectable, Logger } from '@nestjs/common';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Cache in-process (write-through, TTL curto) de resultados de busca por texto/veículo.
 *
 * Buscas populares (ex. "Fiat Strada") se repetem entre usuários do storefront no mesmo
 * curto intervalo — cachear evita recalcular Atlas Search + facets a cada request. TTL
 * curto (60s) porque preço/estoque mudam com frequência; não vale a pena invalidar
 * ativamente, só deixar expirar.
 */
@Injectable()
export class SearchResultCacheService {
  private readonly logger = new Logger(SearchResultCacheService.name);
  private readonly ttlMs = 60_000;
  private readonly store = new Map<string, CacheEntry<unknown>>();

  buildKey(q: string, options: Record<string, unknown>): string {
    const normalized = Object.keys(options)
      .sort()
      .reduce((acc: Record<string, unknown>, key) => {
        if (options[key] !== undefined) acc[key] = options[key];
        return acc;
      }, {});
    return `${q.trim().toLowerCase()}::${JSON.stringify(normalized)}`;
  }

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }
}
