import { Types } from 'mongoose';
import {
  computeDriftFromSellerIds,
  ListingForAudit,
} from '../../scripts/audit-ml-account-drift-multiget';

function oid() {
  return new Types.ObjectId();
}

describe('computeDriftFromSellerIds', () => {
  const RCK_STORE = oid();
  const MAXESHOP_STORE = oid();
  const RCK_ACCOUNT = 'account-rck';
  const MAXESHOP_ACCOUNT = 'account-maxeshop';
  const RCK_SELLER_ID = '111';
  const MAXESHOP_SELLER_ID = '222';

  function listing(overrides: Partial<ListingForAudit> = {}): ListingForAudit {
    return {
      _id: oid(),
      productId: oid(),
      externalId: 'MLB1000000001',
      storeId: RCK_STORE,
      ...overrides,
    };
  }

  const accountBySellerId = new Map([
    [RCK_SELLER_ID, { accountId: RCK_ACCOUNT, label: 'RCK_AUTOMOTIVE' }],
    [MAXESHOP_SELLER_ID, { accountId: MAXESHOP_ACCOUNT, label: 'MAXESHOP' }],
  ]);

  const expectedAccountByStoreId = new Map([
    [String(RCK_STORE), { accountId: RCK_ACCOUNT, label: 'RCK_AUTOMOTIVE' }],
    [String(MAXESHOP_STORE), { accountId: MAXESHOP_ACCOUNT, label: 'MAXESHOP' }],
  ]);

  it('não reporta drift quando o seller_id real bate com a conta esperada pelo storeId', () => {
    const l = listing({ storeId: RCK_STORE });
    const sellerIdByExternalId = new Map([[l.externalId, RCK_SELLER_ID]]);

    const drift = computeDriftFromSellerIds({
      listings: [l],
      sellerIdByExternalId,
      accountBySellerId,
      expectedAccountByStoreId,
    });

    expect(drift).toHaveLength(0);
  });

  it('reporta drift quando o seller_id real pertence a outra conta (caso MLB7191542726/MLB7445938186)', () => {
    const l = listing({ storeId: RCK_STORE, externalId: 'MLB7191542726' });
    const sellerIdByExternalId = new Map([[l.externalId, MAXESHOP_SELLER_ID]]);

    const drift = computeDriftFromSellerIds({
      listings: [l],
      sellerIdByExternalId,
      accountBySellerId,
      expectedAccountByStoreId,
    });

    expect(drift).toHaveLength(1);
    expect(drift[0]).toMatchObject({
      externalId: 'MLB7191542726',
      realAccountId: MAXESHOP_ACCOUNT,
      realAccountLabel: 'MAXESHOP',
      expectedAccountId: RCK_ACCOUNT,
      expectedAccountLabel: 'RCK_AUTOMOTIVE',
    });
  });

  it('pula listing sem retorno no multiget (item não encontrado/removido no ML)', () => {
    const l = listing();
    const sellerIdByExternalId = new Map<string, string>();

    const drift = computeDriftFromSellerIds({
      listings: [l],
      sellerIdByExternalId,
      accountBySellerId,
      expectedAccountByStoreId,
    });

    expect(drift).toHaveLength(0);
  });

  it('pula listing cujo seller_id real não corresponde a nenhuma conta configurada (vendido/transferido para fora)', () => {
    const l = listing();
    const sellerIdByExternalId = new Map([[l.externalId, '999999']]);

    const drift = computeDriftFromSellerIds({
      listings: [l],
      sellerIdByExternalId,
      accountBySellerId,
      expectedAccountByStoreId,
    });

    expect(drift).toHaveLength(0);
  });

  it('pula listing sem storeId (fora de escopo — resolvido por outro mecanismo)', () => {
    const l = listing({ storeId: null });
    const sellerIdByExternalId = new Map([[l.externalId, MAXESHOP_SELLER_ID]]);

    const drift = computeDriftFromSellerIds({
      listings: [l],
      sellerIdByExternalId,
      accountBySellerId,
      expectedAccountByStoreId,
    });

    expect(drift).toHaveLength(0);
  });
});

describe('chunkIds', () => {
  it('divide em lotes de no máximo 20 ids (limite do multiget do ML)', () => {
    const { chunkIds } = require('../../scripts/audit-ml-account-drift-multiget');
    const ids = Array.from({ length: 45 }, (_, i) => `MLB${i}`);
    const chunks = chunkIds(ids, 20);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(20);
    expect(chunks[1]).toHaveLength(20);
    expect(chunks[2]).toHaveLength(5);
  });
});
