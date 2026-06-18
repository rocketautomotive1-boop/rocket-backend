import { Types } from 'mongoose';
import {
  NotFoundException,
  UnprocessableEntityException,
  BadGatewayException,
} from '@nestjs/common';
import { SourceRefreshService } from './source-refresh.service';

const PRODUCT_ID = new Types.ObjectId().toHexString();

function makeService(product: any, publishImpl?: () => Promise<any>) {
  const productModel: any = {
    findById: jest.fn().mockReturnValue({
      select: () => ({ lean: () => ({ exec: async () => product }) }),
    }),
  };
  const amqp = { publish: jest.fn().mockImplementation(publishImpl ?? (async () => undefined)) };
  const service = new SourceRefreshService(productModel, amqp as any);
  return { service, amqp };
}

describe('SourceRefreshService.requestRefresh', () => {
  it('publica o request e retorna um jobId', async () => {
    const { service, amqp } = makeService({ barcode: '7891234567890' });
    const { jobId } = await service.requestRefresh({ productId: PRODUCT_ID, source: 'menorPreco' });

    expect(jobId).toBeTruthy();
    expect(amqp.publish).toHaveBeenCalledWith(
      'rocket.inventory',
      'discovery.source.refresh',
      expect.objectContaining({ productId: PRODUCT_ID, source: 'menorPreco', barcode: '7891234567890', jobId }),
    );
  });

  it('lança NotFound para id inválido', async () => {
    const { service } = makeService(null);
    await expect(service.requestRefresh({ productId: 'nope', source: 'menorPreco' }))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('lança NotFound quando o produto não existe', async () => {
    const { service } = makeService(null);
    await expect(service.requestRefresh({ productId: PRODUCT_ID, source: 'menorPreco' }))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('lança 422 quando o produto não tem barcode', async () => {
    const { service } = makeService({ barcode: '' });
    await expect(service.requestRefresh({ productId: PRODUCT_ID, source: 'menorPreco' }))
      .rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('lança 502 quando a publicação falha', async () => {
    const { service } = makeService({ barcode: '789' }, async () => { throw new Error('mq down'); });
    await expect(service.requestRefresh({ productId: PRODUCT_ID, source: 'menorPreco' }))
      .rejects.toBeInstanceOf(BadGatewayException);
  });
});
