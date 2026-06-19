import { Types } from 'mongoose';
import { QuestionProductResolver } from './question-product.resolver';

const mkt = { _id: new Types.ObjectId() };
const token = 'tok';

function makeSut(overrides: Partial<{
  titleFind: jest.Mock; getItem: jest.Mock; findByBarcode: jest.Mock; titleCreate: jest.Mock;
}> = {}) {
  const productTitleService = {
    findByExternalIdAndMarketplaceId: overrides.titleFind ?? jest.fn().mockResolvedValue(null),
    create: overrides.titleCreate ?? jest.fn(),
  };
  const mercadoLivreService = { getItem: overrides.getItem ?? jest.fn().mockResolvedValue({ status: 'active' }) };
  const productService = { findByBarcode: overrides.findByBarcode ?? jest.fn().mockResolvedValue(null) };
  const sut = new QuestionProductResolver(
    productTitleService as any, mercadoLivreService as any, productService as any,
  );
  return { sut, productTitleService, mercadoLivreService, productService };
}

describe('QuestionProductResolver', () => {
  it('returns productId from an exact Listing match without calling getItem', async () => {
    const pid = new Types.ObjectId();
    const { sut, mercadoLivreService } = makeSut({
      titleFind: jest.fn().mockResolvedValue({ product: { id: pid.toString() } }),
    });
    const result = await sut.resolve('MLB1', mkt, token);
    expect(result?.toString()).toBe(pid.toString());
    expect(mercadoLivreService.getItem).not.toHaveBeenCalled();
  });

  it('positive cache: second resolve does not re-query the title service', async () => {
    const pid = new Types.ObjectId();
    const titleFind = jest.fn().mockResolvedValue({ product: { id: pid.toString() } });
    const { sut } = makeSut({ titleFind });
    await sut.resolve('MLB1', mkt, token);
    await sut.resolve('MLB1', mkt, token);
    expect(titleFind).toHaveBeenCalledTimes(1);
  });

  it('negative cache: a miss is not re-fetched via getItem within TTL', async () => {
    const getItem = jest.fn().mockResolvedValue({ status: 'active' }); // no SKU → no match
    const { sut } = makeSut({ getItem });
    const first = await sut.resolve('MLB_MISS', mkt, token);
    const second = await sut.resolve('MLB_MISS', mkt, token);
    expect(first).toBeNull();
    expect(second).toBeNull();
    expect(getItem).toHaveBeenCalledTimes(1); // second served by negative cache
  });
});
