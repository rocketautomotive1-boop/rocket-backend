import { MenorPrecoClientService } from './menor-preco-client.service';
import { MenorPrecoResult, TRACKER_RESULT_RK } from './menor-preco.types';

describe('MenorPrecoClientService (tracker)', () => {
  let amqp: { publish: jest.Mock };
  let service: MenorPrecoClientService;

  beforeEach(() => {
    jest.useFakeTimers();
    amqp = { publish: jest.fn().mockResolvedValue(undefined) };
    service = new MenorPrecoClientService(amqp as any);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('publica request com reply_to do tracker e resolve pelo correlation_id', async () => {
    const promise = service.fetch('7896000001504');
    expect(amqp.publish).toHaveBeenCalledTimes(1);
    const [, , payload] = amqp.publish.mock.calls[0];
    expect(payload.gtin).toBe('7896000001504');
    expect(payload.reply_to).toBe(TRACKER_RESULT_RK);

    const result: MenorPrecoResult = {
      correlation_id: payload.correlation_id,
      ean: '7896000001504',
      stats: { min: 1, avg: 2, max: 3, count: 4 },
      offers: [],
    };
    service.resolveResult(result);
    await expect(promise).resolves.toEqual(result);
  });

  it('resolve com error=timeout quando o resultado não chega', async () => {
    const promise = service.fetch('7896000001504');
    jest.advanceTimersByTime(31_000);
    const result = await promise;
    expect(result.error).toBe('timeout');
    expect(result.offers).toEqual([]);
  });

  it('resolve com error=publish_error quando o publish falha', async () => {
    amqp.publish.mockRejectedValueOnce(new Error('broker down'));
    const promise = service.fetch('7896000001504');
    // deixa a rejeição do publish propagar pelo microtask queue
    await jest.advanceTimersByTimeAsync(0);
    const result = await promise;
    expect(result.error).toBe('publish_error');
  });

  it('ignora resultado com correlation_id desconhecido', () => {
    expect(() =>
      service.resolveResult({ correlation_id: 'nope', ean: 'x', offers: [] }),
    ).not.toThrow();
  });
});
