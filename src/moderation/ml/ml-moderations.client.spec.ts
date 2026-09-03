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
 * the item is fixed, so it can't be used alone to decide "still moderated". getItemsModerationStatus
 * reads current status/sub_status off the /items multiget (GET /items?ids=...), which IS how ML
 * says to detect an item that is genuinely still under moderation right now (status=under_review
 * with a pending sub_status). Batched (20/call, ML's multiget cap) so the reconciler can check every
 * candidate id every run instead of capping how many get checked.
 */
describe('MlModerationsClient.getItemsModerationStatus', () => {
  const multigetEntry = (id: string, code: number, body: any) => ({ code, body: { id, ...body } });

  it('reports still-moderated for an item under_review with a pending sub_status', async () => {
    const client = new MlModerationsClient();
    (client as any).http = {
      get: jest.fn().mockResolvedValue({
        data: [multigetEntry('MLB1', 200, { status: 'under_review', sub_status: ['waiting_for_patch'] })],
      }),
    };
    const out = await client.getItemsModerationStatus(['MLB1'], 'tok');
    expect(out.get('MLB1')).toEqual({ status: 'under_review', subStatus: ['waiting_for_patch'], stillModerated: true });
  });

  it('reports resolved for an active item with no pending sub_status', async () => {
    const client = new MlModerationsClient();
    (client as any).http = {
      get: jest.fn().mockResolvedValue({ data: [multigetEntry('MLB1', 200, { status: 'active', sub_status: [] })] }),
    };
    const out = await client.getItemsModerationStatus(['MLB1'], 'tok');
    expect(out.get('MLB1')).toEqual({ status: 'active', subStatus: [], stillModerated: false });
  });

  it('fails safe (stillModerated:true) for a per-id error inside an otherwise-successful chunk', async () => {
    const client = new MlModerationsClient();
    (client as any).http = {
      get: jest.fn().mockResolvedValue({
        data: [
          multigetEntry('MLB1', 200, { status: 'active', sub_status: [] }),
          multigetEntry('MLB2', 403, { message: 'Access to the requested resource is forbidden' }),
        ],
      }),
    };
    const out = await client.getItemsModerationStatus(['MLB1', 'MLB2'], 'tok');
    expect(out.get('MLB1')?.stillModerated).toBe(false);
    expect(out.get('MLB2')).toEqual({ status: null, subStatus: [], stillModerated: true });
  });

  it('fails safe for every id in a chunk whose request itself fails (never silently close)', async () => {
    const client = new MlModerationsClient();
    (client as any).http = { get: jest.fn().mockRejectedValue(new Error('500')) };
    const out = await client.getItemsModerationStatus(['MLB1', 'MLB2'], 'tok');
    expect(out.get('MLB1')).toEqual({ status: null, subStatus: [], stillModerated: true });
    expect(out.get('MLB2')).toEqual({ status: null, subStatus: [], stillModerated: true });
  });

  it('chunks into groups of 20 (ML multiget cap): 21 ids -> 2 requests, sizes 20 then 1', async () => {
    const ids = Array.from({ length: 21 }, (_, i) => `MLB${i}`);
    const get = jest.fn().mockImplementation((_path: string, config: any) => {
      const chunkIds: string[] = config.params.ids.split(',');
      return Promise.resolve({
        data: chunkIds.map((id) => multigetEntry(id, 200, { status: 'active', sub_status: [] })),
      });
    });
    const client = new MlModerationsClient();
    (client as any).http = { get };

    const out = await client.getItemsModerationStatus(ids, 'tok');

    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls[0][1].params.ids.split(',')).toHaveLength(20);
    expect(get.mock.calls[1][1].params.ids.split(',')).toHaveLength(1);
    expect(out.size).toBe(21);
  });
});
