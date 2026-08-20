import { StoreModel, FiscalChannel } from '../schemas/store.schema';

export const STORE_PORT = Symbol('STORE_PORT');

export interface StorePort {
  findById(storeId: string): Promise<(StoreModel & { id: string }) | null>;
  findByName(name: string): Promise<(StoreModel & { id: string }) | null>;
  resolveAccountId(storeId: string | null | undefined, marketplaceTag: string): Promise<string | null>;
  resolveAccountIds(storeId: string | null | undefined, marketplaceTag: string): Promise<string[]>;

  /** Loja dona da conta (marketplaceTag, accountId) — inverso de resolveAccountId(s). */
  resolveStoreForAccount(marketplaceTag: string, accountId: string): Promise<(StoreModel & { id: string }) | null>;

  resolveFiscalChannel(
    storeId: string,
    marketplaceTag: string,
    accountId: string,
  ): Promise<FiscalChannel | null>;

  /** Reserva atomicamente o próximo número de NFe para este canal fiscal. */
  reserveFiscalNumber(
    storeId: string,
    marketplaceTag: string,
    accountId: string,
  ): Promise<{ series: number; number: number }>;
}
