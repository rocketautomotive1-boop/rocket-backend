import { Types } from 'mongoose';
import { reportWrongStoreListings } from '../../scripts/report-wrong-store-listings';

function oid() {
  return new Types.ObjectId();
}

describe('reportWrongStoreListings', () => {
  it('ignora StoreListing que já está sob a loja correta', async () => {
    const productId = oid();
    const correctStoreId = oid();
    const correctSl = { _id: oid(), storeId: correctStoreId };

    const report = await reportWrongStoreListings({
      listings: [{ productId, correctStoreId }],
      findStoreListingsForProduct: async () => [correctSl],
      getBalances: async () => [{ condition: 'new', onHand: 5, reserved: 0, boxId: null }],
      countLots: async () => 1,
      countMovements: async () => 3,
      countDamagedUnits: async () => 0,
      getMarketplaceListings: async () => [],
    });

    expect(report.totalWrong).toBe(0);
  });

  it('reporta StoreListing sob loja errada com saldo real, e detecta destino livre', async () => {
    const productId = oid();
    const correctStoreId = oid();
    const wrongStoreId = oid();
    const wrongSl = { _id: oid(), storeId: wrongStoreId };

    const report = await reportWrongStoreListings({
      listings: [{ productId, correctStoreId }],
      findStoreListingsForProduct: async () => [wrongSl],
      getBalances: async () => [{ condition: 'new', onHand: 10, reserved: 2, boxId: null }],
      countLots: async () => 1,
      countMovements: async () => 4,
      countDamagedUnits: async () => 0,
      getMarketplaceListings: async () => [{ marketplaceTag: 'mercadolivre', externalId: 'MLB1', status: 'active' }],
    });

    expect(report.totalWrong).toBe(1);
    expect(report.destinationFree).toBe(1);
    expect(report.destinationOccupied).toBe(0);
    expect(report.rows[0].destinationStoreListingId).toBeNull();
    expect(report.totalOnHandUnitsAffected).toBe(10);
    expect(report.totalMarketplaceListingsAffected).toBe(1);
  });

  it('detecta quando o destino (loja correta) já tem um StoreListing próprio — precisa merge', async () => {
    const productId = oid();
    const correctStoreId = oid();
    const wrongStoreId = oid();
    const wrongSl = { _id: oid(), storeId: wrongStoreId };
    const destinationSl = { _id: oid(), storeId: correctStoreId };

    const report = await reportWrongStoreListings({
      listings: [{ productId, correctStoreId }],
      findStoreListingsForProduct: async () => [wrongSl, destinationSl],
      getBalances: async (storeListingId) =>
        storeListingId === wrongSl._id ? [{ condition: 'new', onHand: 3, reserved: 0, boxId: null }] : [],
      countLots: async () => 1,
      countMovements: async () => 1,
      countDamagedUnits: async () => 0,
      getMarketplaceListings: async () => [],
    });

    expect(report.totalWrong).toBe(1);
    expect(report.destinationOccupied).toBe(1);
    expect(report.rows[0].destinationStoreListingId).toBe(destinationSl._id);
  });

  it('ignora StoreListing sob loja errada mas SEM dados reais (sem saldo, sem marketplace_listings)', async () => {
    const productId = oid();
    const correctStoreId = oid();
    const wrongStoreId = oid();
    const emptySl = { _id: oid(), storeId: wrongStoreId };

    const report = await reportWrongStoreListings({
      listings: [{ productId, correctStoreId }],
      findStoreListingsForProduct: async () => [emptySl],
      getBalances: async () => [{ condition: 'new', onHand: 0, reserved: 0, boxId: null }],
      countLots: async () => 0,
      countMovements: async () => 0,
      countDamagedUnits: async () => 0,
      getMarketplaceListings: async () => [],
    });

    expect(report.totalWrong).toBe(0);
  });

  it('não duplica o mesmo StoreListing conflitante quando dois listings do mesmo produto o referenciam', async () => {
    const productId = oid();
    const correctStoreId = oid();
    const wrongStoreId = oid();
    const wrongSl = { _id: oid(), storeId: wrongStoreId };

    const report = await reportWrongStoreListings({
      listings: [
        { productId, correctStoreId },
        { productId, correctStoreId },
      ],
      findStoreListingsForProduct: async () => [wrongSl],
      getBalances: async () => [{ condition: 'new', onHand: 1, reserved: 0, boxId: null }],
      countLots: async () => 1,
      countMovements: async () => 1,
      countDamagedUnits: async () => 0,
      getMarketplaceListings: async () => [],
    });

    expect(report.totalWrong).toBe(1);
  });
});
