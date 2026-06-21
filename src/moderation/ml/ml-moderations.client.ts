import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { MlInfraction, MlLastModeration } from '../providers/mercadolivre-moderation.provider';

const ML_BASE_URL = 'https://api.mercadolibre.com';

/**
 * Thin read client for ML's moderation endpoints. The reconciler treats /infractions as the
 * source of truth; last_moderation enriches reason/remedy wordings. Ported from the
 * moderations microservice (which is being deleted). Token is passed in by the caller
 * (resolved live via the token broker — never cached, per CLAUDE.md).
 */
@Injectable()
export class MlModerationsClient {
  private readonly logger = new Logger(MlModerationsClient.name);
  private readonly http: AxiosInstance;

  constructor() {
    this.http = axios.create({ baseURL: ML_BASE_URL, timeout: 10_000 });
  }

  async getAllInfractions(accessToken: string, userId: number | string): Promise<MlInfraction[]> {
    try {
      const res = await this.http.get(`/moderations/infractions/${userId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      return Array.isArray(res.data) ? res.data : (res.data?.results ?? []);
    } catch (err) {
      this.logger.error(`getAllInfractions(${userId}) failed: ${(err as Error).message}`);
      return [];
    }
  }

  async getLastModeration(itemId: string, accessToken: string): Promise<MlLastModeration | undefined> {
    try {
      const res = await this.http.get(`/moderations/last_moderation/${itemId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      return res.data ?? undefined;
    } catch {
      return undefined;
    }
  }

  /** Current category id of a published item (wrong-category needs the blocked category). */
  async getItemCategoryId(itemId: string, accessToken: string): Promise<string | null> {
    try {
      const res = await this.http.get(`/items/${itemId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { attributes: 'category_id' },
      });
      return res.data?.category_id ? String(res.data.category_id) : null;
    } catch {
      return null;
    }
  }
}
