import { Injectable } from '@nestjs/common';
@Injectable()
export class WebhookMetricsService {
  private readonly received = new Map<string, number>();
  private readonly rejected = new Map<string, number>();
  private readonly dead = new Map<string, number>();
  incReceived(marketplace: string, kind: string) { this.bump(this.received, `${marketplace}:${kind}`); }
  incRejected(marketplace: string, reason: string) { this.bump(this.rejected, `${marketplace}:${reason}`); }
  incDead(marketplace: string, kind: string) { this.bump(this.dead, `${marketplace}:${kind}`); }
  snapshot() { return { received: this.toObj(this.received), rejected: this.toObj(this.rejected), dead: this.toObj(this.dead) }; }
  private bump(m: Map<string,number>, k: string) { m.set(k, (m.get(k) ?? 0) + 1); }
  private toObj(m: Map<string,number>) { return Object.fromEntries(m); }
}
