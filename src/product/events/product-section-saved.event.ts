export const PRODUCT_SECTION_EVENTS = {
  DIMENSIONS_SAVED: 'product.dimensions.saved',
  IMAGES_SAVED: 'product.images.saved',
  TITLES_SAVED: 'product.titles.saved',
  TITLE_ID_RESOLVED: 'product.titleId.resolved',
  CATEGORY_SAVED: 'product.category.saved',
  INVENTORY_SAVED: 'product.inventory.saved',
  DATA_SAVED: 'product.data.saved',
  BECAME_READY: 'product.became.ready',
} as const;

export class ProductDimensionsSavedEvent {
  constructor(public readonly productId: string, public readonly at: Date = new Date()) {}
}

export class ProductImagesSavedEvent {
  constructor(public readonly productId: string, public readonly at: Date = new Date()) {}
}

export class ProductTitlesSavedEvent {
  constructor(public readonly productId: string, public readonly at: Date = new Date()) {}
}

export class ProductTitleIdResolvedEvent {
  constructor(
    public readonly productId: string,
    public readonly titleId: string,
    public readonly at: Date = new Date(),
  ) {}
}

export class ProductCategorySavedEvent {
  constructor(public readonly productId: string, public readonly at: Date = new Date()) {}
}

export class ProductInventorySavedEvent {
  constructor(public readonly productId: string, public readonly at: Date = new Date()) {}
}

export class ProductDataSavedEvent {
  constructor(public readonly productId: string, public readonly at: Date = new Date()) {}
}

export class ProductBecameReadyEvent {
  constructor(
    public readonly productId: string,
    public readonly completedAt: Date,
  ) {}
}
