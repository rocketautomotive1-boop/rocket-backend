export const PRODUCT_COMPATIBILITY_PORT = Symbol('PRODUCT_COMPATIBILITY_PORT');

/** Compatibilidade de veículo já resolvida, pronta para ir a um marketplace. */
export interface ProductCompatibilityRecord {
  _id?: unknown;
  id?: unknown;
  vehicleId: string;
  /** id do veículo no catálogo do marketplace (ex.: "MLB22578636" no ML). */
  mlVehicleId?: string;
}

/**
 * Porta enxuta para o lado de Marketplace ler/gravar o resultado de sync de
 * compatibilidades sem depender do ProductModule inteiro (e do forwardRef que
 * isso implica). Espelha o padrão de order/ports/product-resolver.port.ts —
 * ProductModule provê PRODUCT_COMPATIBILITY_PORT via useExisting apontando
 * para ProductCompatibilityService, que já implementa esta interface.
 */
export interface ProductCompatibilityPort {
  getCompatibilitiesByProduct(productId: string): Promise<ProductCompatibilityRecord[]>;
  markAsSynced(ids: Array<string | number>): Promise<void>;
}
