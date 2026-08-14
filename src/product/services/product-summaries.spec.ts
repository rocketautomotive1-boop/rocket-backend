import { ProductService } from '../product.service';

/**
 * Focused unit test for ProductService.getSummariesByIds — dedupe of ids and
 * main-image resolution. Only the repository is stubbed; the rest of the
 * service graph is irrelevant to this method.
 */
function makeService(findSummariesByIds: jest.Mock): ProductService {
  const repo = { findSummariesByIds } as any;
  // Only productRepository is touched by getSummariesByIds.
  return new (ProductService as any)(repo);
}

describe('ProductService.getSummariesByIds', () => {
  it('returns [] for empty / falsy ids without hitting the repo', async () => {
    const find = jest.fn();
    const svc = makeService(find);
    expect(await svc.getSummariesByIds([])).toEqual([]);
    expect(await svc.getSummariesByIds([null as any, undefined as any, ''])).toEqual([]);
    expect(find).not.toHaveBeenCalled();
  });

  it('dedupes ids before querying', async () => {
    const find = jest.fn().mockResolvedValue([]);
    const svc = makeService(find);
    await svc.getSummariesByIds(['a', 'a', 'b']);
    expect(find).toHaveBeenCalledWith(['a', 'b']);
  });

  it('picks the main image, falling back to the first', async () => {
    const find = jest.fn().mockResolvedValue([
      { _id: 'a', name: 'Prod A', images: [{ url: 'u1', main: false }, { url: 'u2', main: true }] },
      { _id: 'b', name: 'Prod B', images: [{ url: 'first' }] },
      { _id: 'c', name: 'Prod C', images: [] },
      { _id: 'd', name: 'Prod D' },
    ]);
    const svc = makeService(find);
    const out = await svc.getSummariesByIds(['a', 'b', 'c', 'd']);
    expect(out).toEqual([
      { id: 'a', name: 'Prod A', image: 'u2' },
      { id: 'b', name: 'Prod B', image: 'first' },
      { id: 'c', name: 'Prod C', image: null },
      { id: 'd', name: 'Prod D', image: null },
    ]);
  });
});
