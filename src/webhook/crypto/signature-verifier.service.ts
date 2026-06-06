import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import * as axios from 'axios';
import { MarketplaceCredentialsService } from '../../marketplace/credentials/marketplace-credentials.service';
import { SignatureScheme, WebhookContext } from '../adapters/webhook-adapter.interface';

@Injectable()
export class SignatureVerifier {
  private readonly logger = new Logger(SignatureVerifier.name);
  private readonly certCache = new Map<string, string>();

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
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
  }

  private async fetchCertificate(url: string): Promise<string> {
    const cached = this.certCache.get(url);
    if (cached) return cached;
    const { data } = await axios.default.get<string>(url, { responseType: 'text' });
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
}
