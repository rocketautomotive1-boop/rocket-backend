import { MlModerationsClient } from './ml-moderations.client';

/**
 * Locks the /infractions response parsing. The live ML API returns
 * { infractions: [...], paging, sorting_type } — NOT { results }. A regression here makes the
 * whole pipeline silently see zero infractions (the bug the live trace caught).
 */
describe('MlModerationsClient.getAllInfractions parsing', () => {
  const make = (data: any) => {
    const client = new MlModerationsClient();
    (client as any).http = { get: jest.fn().mockResolvedValue({ data }) };
    return client;
  };

  const page = (items: any[], total: number) => ({ data: { infractions: items, paging: { total } } });

  it('reads the real ML shape { infractions: [...] } (single short page stops)', async () => {
    const client = new MlModerationsClient();
    (client as any).http = { get: jest.fn().mockResolvedValue(page([{ id: 'INF1' }], 1)) };
    const out = await client.getAllInfractions('tok', 123);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('INF1');
  });

  it('paginates by offset until total is reached (cap=20)', async () => {
    const full = Array.from({ length: 20 }, (_, i) => ({ id: `A${i}` }));
    const get = jest
      .fn()
      .mockResolvedValueOnce(page(full, 30)) // page 0: 20 items, total 30
      .mockResolvedValueOnce(page(Array.from({ length: 10 }, (_, i) => ({ id: `B${i}` })), 30)); // page 1: 10
    const client = new MlModerationsClient();
    (client as any).http = { get };

    const out = await client.getAllInfractions('tok', 1);

    expect(out).toHaveLength(30);
    expect(get).toHaveBeenCalledTimes(2);
    // first call offset 0, second offset 20, both limit 20
    expect(get.mock.calls[0][1].params).toEqual({ limit: 20, offset: 0 });
    expect(get.mock.calls[1][1].params).toEqual({ limit: 20, offset: 20 });
  });

  it('stops on an empty page (ML cap quirk: null infractions)', async () => {
    const get = jest
      .fn()
      .mockResolvedValueOnce(page(Array.from({ length: 20 }, (_, i) => ({ id: i })), 999))
      .mockResolvedValueOnce({ data: { infractions: null, paging: null } });
    const client = new MlModerationsClient();
    (client as any).http = { get };
    const out = await client.getAllInfractions('tok', 1);
    expect(out).toHaveLength(20);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('falls back to { results: [...] }', async () => {
    const client = new MlModerationsClient();
    (client as any).http = { get: jest.fn().mockResolvedValue({ data: { results: [{ id: 'R1' }] } }) };
    expect(await client.getAllInfractions('tok', 1)).toHaveLength(1);
  });

  it('returns what it has (not throw) when a page fails mid-way', async () => {
    const get = jest
      .fn()
      .mockResolvedValueOnce(page(Array.from({ length: 20 }, (_, i) => ({ id: i })), 999))
      .mockRejectedValueOnce(new Error('500'));
    const client = new MlModerationsClient();
    (client as any).http = { get };
    expect(await client.getAllInfractions('tok', 1)).toHaveLength(20);
  });
});

/**
 * /moderations/infractions is a historical log — per ML's own docs it never closes an entry when
 * the item is fixed, so it can't be used alone to decide "still moderated". getItemModerationStatus
 * reads current status/sub_status/tags off /items/{id}, which IS how ML says to detect an item that
 * is genuinely still under moderation right now (status=under_review with a pending sub_status).
 */
describe('MlModerationsClient.getItemModerationStatus', () => {
  it('reports still-moderated for an item under_review with a pending sub_status', async () => {
    const client = new MlModerationsClient();
    (client as any).http = {
      get: jest.fn().mockResolvedValue({
        data: { status: 'under_review', sub_status: ['waiting_for_patch'], tags: ['incomplete_compatibilities'] },
      }),
    };
    const out = await client.getItemModerationStatus('MLB1', 'tok');
    expect(out).toEqual({ status: 'under_review', subStatus: ['waiting_for_patch'], stillModerated: true });
  });

  it('reports resolved for an active item with no pending sub_status', async () => {
    const client = new MlModerationsClient();
    (client as any).http = {
      get: jest.fn().mockResolvedValue({ data: { status: 'active', sub_status: [], tags: ['cart_eligible'] } }),
    };
    const out = await client.getItemModerationStatus('MLB1', 'tok');
    expect(out).toEqual({ status: 'active', subStatus: [], stillModerated: false });
  });

  it('treats a lookup failure as still-moderated (fail safe, never silently close)', async () => {
    const client = new MlModerationsClient();
    (client as any).http = { get: jest.fn().mockRejectedValue(new Error('500')) };
    const out = await client.getItemModerationStatus('MLB1', 'tok');
    expect(out.stillModerated).toBe(true);
  });
});
