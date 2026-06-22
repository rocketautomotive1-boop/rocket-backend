import { Injectable } from '@nestjs/common';
import {
  CanonicalModeration,
  CanonicalSuggestedCategory,
  ModerationProvider,
  ModerationType,
} from './moderation-provider.types';

/**
 * Raw ML infraction (GET /moderations/infractions/{userId}).
 * Reference: https://developers.mercadolivre.com.br/pt_br/gerenciar-moderacoes
 */
export interface MlInfraction {
  id?: string;
  date_created?: string;
  user_id?: string;
  related_item_id?: string;
  element_id?: string;
  element_type?: string;
  site_id?: string;
  filter_subgroup?: string;
  suggested?: { categories: Array<{ id: string; name?: string; path?: string; domain?: string }> };
  reason?: string;
  remedy?: string;
}

/** Raw ML last_moderation (GET /moderations/last_moderation/{referenceId}). */
export interface MlLastModeration {
  name?: string;
  id?: string;
  date_created?: string;
  evidences?: Array<{ text_matched?: string; section_name?: string }>;
  wordings?: Array<{ type: 'REASON' | 'REMEDY'; value: string }>;
}

// Subgroups verified live against a real seller account (2527 infractions). The values the ML API
// actually emits differ from the docs in a few cases — FOTOS (not PQT), CATALOG (not OPT_OBEY), and
// PP (prohibited product) had no mapping and were silently UNKNOWN. Docs-era aliases are kept too.
const SUBGROUP_TO_TYPE: Record<string, ModerationType> = {
  // verified live
  COMPATS: 'MISSING_COMPATIBILITIES',
  DOMAIN: 'WRONG_CATEGORY',
  DP: 'CONTACT_DATA',
  PP: 'PROHIBITED',
  FOTOS: 'PHOTO_QUALITY',
  DUPLIS: 'DUPLICATE',
  CATALOG: 'CATALOG_REQUIRED',
  PQT: 'PHOTO_QUALITY',
  // docs-era aliases (kept defensively)
  DESC: 'PRICE_CHANGE',
  OPT_OBEY: 'CATALOG_REQUIRED',
  CATALOG_ONLY_RESTRICTED: 'CATALOG_REQUIRED',
  OPT_OUT_REPRODUCTIZAR: 'CATALOG_REQUIRED',
  LINKS: 'CONTACT_DATA',
  BRAND_PROTECTION: 'BRAND_PROTECTION',
  CLASI: 'CLASSIFICATION',
};

@Injectable()
export class MercadoLivreModerationProvider implements ModerationProvider {
  readonly marketplace = 'mercadolivre';

  classify(subgroup: string): ModerationType {
    return SUBGROUP_TO_TYPE[subgroup] ?? 'UNKNOWN';
  }

  toCanonical(infraction: MlInfraction, lastModeration?: MlLastModeration): CanonicalModeration {
    const subgroup = infraction.filter_subgroup ?? 'UNKNOWN';
    const externalId = String(infraction.element_id || infraction.related_item_id || '');

    const reason =
      lastModeration?.wordings?.find((w) => w.type === 'REASON')?.value ??
      infraction.reason ??
      undefined;

    const remedy =
      lastModeration?.wordings?.find((w) => w.type === 'REMEDY')?.value ??
      infraction.remedy ??
      undefined;

    const suggestedCategories: CanonicalSuggestedCategory[] | undefined =
      infraction.suggested?.categories?.map((c) => ({
        externalId: String(c.id),
        name: c.name,
        path: c.path,
        domain: c.domain,
      }));

    return {
      marketplace: this.marketplace,
      externalId,
      type: this.classify(subgroup),
      subgroup,
      infractionId: infraction.id ? String(infraction.id) : undefined,
      reason,
      remedy,
      suggestedCategories,
      detectedAt: infraction.date_created ? new Date(infraction.date_created) : new Date(),
      raw: infraction,
    };
  }
}
