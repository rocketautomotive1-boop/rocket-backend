import { Types } from 'mongoose';
import { planSingleListingRelocation } from '../../scripts/relocate-single-ml-listing';

function oid() {
  return new Types.ObjectId();
}

describe('planSingleListingRelocation', () => {
  const PRODUCT = oid();
  const FROM_STORE = oid();
  const TO_STORE = oid();
  const SOURCE_SL = oid();
  const DEST_SL = oid();
  const ML_ROW = oid();
  const LISTING_ID = oid();

  it('reaponta o marketplace_listing e o Listing quando o destino não tem conflito (destino sem StoreListing)', () => {
    const plan = planSingleListingRelocation({
      productId: PRODUCT,
      externalId: 'MLB1',
      listingId: LISTING_ID,
      fromStoreId: FROM_STORE,
      toStoreId: TO_STORE,
      sourceStoreListingId: SOURCE_SL,
      destinationStoreListingId: null,
      sourceMarketplaceListingId: ML_ROW,
      destinationHasConflictingExternalId: false,
    });

    expect(plan).toEqual({
      kind: 'relocate',
      createDestinationStoreListing: true,
      destinationStoreListingId: null,
      sourceMarketplaceListingId: ML_ROW,
      listingId: LISTING_ID,
    });
  });

  it('reaponta sem criar StoreListing quando o destino já existe e não tem conflito', () => {
    const plan = planSingleListingRelocation({
      productId: PRODUCT,
      externalId: 'MLB1',
      listingId: LISTING_ID,
      fromStoreId: FROM_STORE,
      toStoreId: TO_STORE,
      sourceStoreListingId: SOURCE_SL,
      destinationStoreListingId: DEST_SL,
      sourceMarketplaceListingId: ML_ROW,
      destinationHasConflictingExternalId: false,
    });

    expect(plan).toEqual({
      kind: 'relocate',
      createDestinationStoreListing: false,
      destinationStoreListingId: DEST_SL,
      sourceMarketplaceListingId: ML_ROW,
      listingId: LISTING_ID,
    });
  });

  it('bloqueia quando já existe marketplace_listing com o mesmo externalId no destino', () => {
    const plan = planSingleListingRelocation({
      productId: PRODUCT,
      externalId: 'MLB1',
      listingId: LISTING_ID,
      fromStoreId: FROM_STORE,
      toStoreId: TO_STORE,
      sourceStoreListingId: SOURCE_SL,
      destinationStoreListingId: DEST_SL,
      sourceMarketplaceListingId: ML_ROW,
      destinationHasConflictingExternalId: true,
    });

    expect(plan.kind).toBe('blocked');
  });

  it('noop quando não há marketplace_listing de origem para mover', () => {
    const plan = planSingleListingRelocation({
      productId: PRODUCT,
      externalId: 'MLB1',
      listingId: LISTING_ID,
      fromStoreId: FROM_STORE,
      toStoreId: TO_STORE,
      sourceStoreListingId: SOURCE_SL,
      destinationStoreListingId: null,
      sourceMarketplaceListingId: null,
      destinationHasConflictingExternalId: false,
    });

    expect(plan.kind).toBe('noop');
  });

  it('não move outros marketplace_listings do mesmo StoreListing — plano só referencia o sourceMarketplaceListingId dado', () => {
    const otherRowId = oid();
    const plan = planSingleListingRelocation({
      productId: PRODUCT,
      externalId: 'MLB1',
      listingId: LISTING_ID,
      fromStoreId: FROM_STORE,
      toStoreId: TO_STORE,
      sourceStoreListingId: SOURCE_SL,
      destinationStoreListingId: null,
      sourceMarketplaceListingId: ML_ROW,
      destinationHasConflictingExternalId: false,
    });

    expect(plan.kind === 'relocate' && plan.sourceMarketplaceListingId).toEqual(ML_ROW);
    expect(plan.kind === 'relocate' && plan.sourceMarketplaceListingId).not.toEqual(otherRowId);
  });
});
