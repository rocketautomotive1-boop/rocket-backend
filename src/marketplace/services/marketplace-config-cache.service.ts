import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MarketplaceModel, MarketplaceDocument } from '../schemas/marketplace.schema';

/**
 * Forma plana e imutável (POJO congelado) de um marketplace, SEM o token volátil.
 * É o que servimos do cache para todas as leituras de config.
 */
export type MarketplaceConfig = Omit<MarketplaceModel, never> & { _id: any; id: string };

/**
 * Cache in-process (write-through) da config de marketplaces.
 *
 * Os dados de marketplace (name/tag/enabled/requirements/credentials/contas)
 * mudam raríssimo, mas são lidos milhares de vezes (todo sync, broker de token,
 * ingest de order). Esta camada hidrata a coleção inteira de uma vez (.lean()),
 * remove o sub-campo volátil `accounts[].token` (renovado a cada poucas horas —
 * não deve ficar em cache nem invalidá-lo) e congela cada documento.
 *
 * Premissas (válidas hoje): processo único (sem coordenação distribuída) e todo
 * caminho de escrita de config passa por código nosso, que chama `invalidate()`.
 * Leitura de TOKEN NÃO usa este cache — continua indo ao Mongo ao vivo.
 */
@Injectable()
export class MarketplaceConfigCacheService {
  private readonly logger = new Logger(MarketplaceConfigCacheService.name);

  private byId: Map<string, MarketplaceConfig> | null = null;
  private byTag = new Map<string, MarketplaceConfig>();
  private byName = new Map<string, MarketplaceConfig>();

  constructor(
    @InjectModel(MarketplaceModel.name)
    private readonly marketplaceModel: Model<MarketplaceDocument>,
  ) {}

  /** Limpa o cache. Próxima leitura re-hidrata. Chamado por toda escrita de config. */
  invalidate(): void {
    this.byId = null;
    this.byTag.clear();
    this.byName.clear();
  }

  async getAll(): Promise<MarketplaceConfig[]> {
    const map = await this.ensureHydrated();
    return [...map.values()];
  }

  async getById(id: string): Promise<MarketplaceConfig | null> {
    if (!id || !/^[0-9a-fA-F]{24}$/.test(String(id))) return null;
    const map = await this.ensureHydrated();
    return map.get(String(id)) ?? null;
  }

  async getByTag(tag: string): Promise<MarketplaceConfig | null> {
    if (!tag) return null;
    await this.ensureHydrated();
    return this.byTag.get(tag) ?? null;
  }

  async getByName(name: string): Promise<MarketplaceConfig | null> {
    if (!name) return null;
    await this.ensureHydrated();
    return this.byName.get(name) ?? null;
  }

  /** Resolve tag/name/id → marketplaceId (ObjectId string). null se não achar. */
  async resolveId(tagOrId: string): Promise<string | null> {
    if (!tagOrId) return null;
    if (/^[0-9a-fA-F]{24}$/.test(tagOrId)) return tagOrId;
    await this.ensureHydrated();
    const mp = this.byTag.get(tagOrId) ?? this.byName.get(tagOrId);
    return mp ? String(mp._id) : null;
  }

  /** Carrega tudo (1 query), strip de token, freeze e monta os índices. */
  private async ensureHydrated(): Promise<Map<string, MarketplaceConfig>> {
    if (this.byId) return this.byId;

    const docs = await this.marketplaceModel.find().lean().exec();
    const byId = new Map<string, MarketplaceConfig>();
    this.byTag.clear();
    this.byName.clear();

    for (const raw of docs) {
      const cfg = this.stripAndFreeze(raw);
      byId.set(String(cfg._id), cfg);
      if ((cfg as any).tag) this.byTag.set((cfg as any).tag, cfg);
      if ((cfg as any).name) this.byName.set((cfg as any).name, cfg);
    }

    this.byId = byId;
    this.logger.debug(`Marketplace config cache hidratado: ${byId.size} marketplaces`);
    return byId;
  }

  /**
   * Remove o token volátil de cada conta e congela o objeto. Mantém o restante
   * de `accounts[]` (label/credentials) e `activeAccountId` — config estável,
   * lida pelo broker para resolver a conta ativa de publicação.
   */
  private stripAndFreeze(raw: any): MarketplaceConfig {
    const accounts = Array.isArray(raw.accounts)
      ? raw.accounts.map((a: any) => {
          const { token, ...rest } = a ?? {};
          return Object.freeze(rest);
        })
      : [];
    const cfg = { ...raw, id: String(raw._id), accounts };
    return Object.freeze(cfg) as MarketplaceConfig;
  }
}
