import { StoreModel } from '../schemas/store.schema';

export const STORE_PORT = Symbol('STORE_PORT');

export interface StorePort {
  findById(storeId: string): Promise<(StoreModel & { id: string }) | null>;
  resolveAccountId(storeId: string | null | undefined, marketplaceTag: string): Promise<string | null>;
  resolveAccountIds(storeId: string | null | undefined, marketplaceTag: string): Promise<string[]>;
}
