import { Injectable } from '@nestjs/common';

interface PendingSearchState {
  expiresAt: number;
}

@Injectable()
export class WhatsAppCommandSession {
  private readonly pendingSearch = new Map<string, PendingSearchState>();
  private readonly TTL_MS = 5 * 60 * 1000;

  beginProductSearch(senderNumber: string): void {
    this.pendingSearch.set(senderNumber, { expiresAt: Date.now() + this.TTL_MS });
  }

  consumePendingProductSearch(senderNumber: string, body: string): string | null {
    const state = this.pendingSearch.get(senderNumber);
    if (!state) return null;

    if (state.expiresAt <= Date.now()) {
      this.pendingSearch.delete(senderNumber);
      return null;
    }

    this.pendingSearch.delete(senderNumber);
    const term = (body ?? '').trim();
    return term.length ? term : null;
  }
}
