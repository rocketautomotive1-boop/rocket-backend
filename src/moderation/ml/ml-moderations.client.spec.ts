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
