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

  /**
   * Fetches ALL active infractions, paginating by offset. Two ML quirks (both verified live and
   * each capable of silently hiding every infraction):
   *  1. The payload is `{ infractions: [...], paging }` — NOT `{ results }`.
   *  2. `limit` is capped at 20. Asking for `limit >= 21` returns `{ infractions: null, paging: null }`
   *     — HTTP 200, no error. So we page at 20 and walk `offset` until exhausted.
   */
  async getAllInfractions(accessToken: string, userId: number | string): Promise<MlInfraction[]> {
    const PAGE = 20; // hard cap; >20 yields an empty page
    const MAX_PAGES = 500; // safety valve (10k infractions)
    const all: MlInfraction[] = [];
    try {
      for (let page = 0; page < MAX_PAGES; page++) {
        const offset = page * PAGE;
        const res = await this.http.get(`/moderations/infractions/${userId}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: { limit: PAGE, offset },
        });
        const d = res.data;
        const batch: MlInfraction[] = Array.isArray(d) ? d : (d?.infractions ?? d?.results ?? []);
        if (!batch.length) break;
        all.push(...batch);

        const total = d?.paging?.total;
        if (typeof total === 'number' && offset + batch.length >= total) break;
        if (batch.length < PAGE) break;
      }
      return all;
    } catch (err) {
      this.logger.error(`getAllInfractions(${userId}) failed after ${all.length} fetched: ${(err as Error).message}`);
      return all; // return what we have rather than dropping everything
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

  /**
   * ML's own docs: /moderations/infractions is a historical log that never closes an entry when
   * the item is fixed — it is NOT a signal that an item is still moderated. The doc's recommended
   * way to detect that is status=under_review with one of a known set of pending sub_status values
   * (see "Gerenciar Moderações" — warning/waiting_for_patch/held/pending_documentation/forbidden/
   * picture_downloading_pending), which is what this reads off /items/{id}. On lookup failure we
   * fail safe (stillModerated=true) — never silently close a moderation state we couldn't verify.
   */
  async getItemModerationStatus(
    itemId: string,
    accessToken: string,
  ): Promise<{ status: string | null; subStatus: string[]; stillModerated: boolean }> {
    const PENDING_SUB_STATUS = new Set([
      'warning',
      'waiting_for_patch',
      'held',
      'pending_documentation',
      'forbidden',
      'picture_downloading_pending',
    ]);
    try {
      const res = await this.http.get(`/items/${itemId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { attributes: 'status,sub_status' },
      });
      const status: string | null = res.data?.status ?? null;
      const subStatus: string[] = Array.isArray(res.data?.sub_status) ? res.data.sub_status : [];
      const stillModerated = status === 'under_review' && subStatus.some((s) => PENDING_SUB_STATUS.has(s));
      return { status, subStatus, stillModerated };
    } catch {
      return { status: null, subStatus: [], stillModerated: true };
    }
  }
}
