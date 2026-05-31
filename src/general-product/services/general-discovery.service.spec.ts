// backend/src/general-product/services/general-discovery.service.spec.ts
import { BadRequestException } from '@nestjs/common';
import { GeneralDiscoveryService } from './general-discovery.service';

describe('GeneralDiscoveryService', () => {
  const makeAmqp = () => ({ publish: jest.fn().mockResolvedValue(undefined) });

  it('rejects an invalid EAN-13 barcode and does NOT publish', async () => {
    const amqp = makeAmqp();
    const service = new GeneralDiscoveryService(amqp as any);

    await expect(service.startByBarcode('1234567890000')).rejects.toBeInstanceOf(BadRequestException);
    expect(amqp.publish).not.toHaveBeenCalled();
  });

  it('publishes discovery.general.request with the correct payload for a valid barcode', async () => {
    const amqp = makeAmqp();
    const service = new GeneralDiscoveryService(amqp as any);

    const jobId = await service.startByBarcode('7891000100103');

    expect(typeof jobId).toBe('string');
    expect(jobId.length).toBeGreaterThan(0);
    expect(amqp.publish).toHaveBeenCalledTimes(1);
    const [exchange, routingKey, payload] = amqp.publish.mock.calls[0];
    expect(exchange).toBe('rocket.inventory');
    expect(routingKey).toBe('discovery.general.request');
    expect(payload).toEqual({
      jobId,
      barcode: '7891000100103',
      query: '7891000100103',
      domain: 'general',
    });
  });

  it('defaults domain to "general"', async () => {
    const amqp = makeAmqp();
    const service = new GeneralDiscoveryService(amqp as any);
    await service.startByBarcode('7891000100103');
    const [, , payload] = amqp.publish.mock.calls[0];
    expect(payload.domain).toBe('general');
  });
});
