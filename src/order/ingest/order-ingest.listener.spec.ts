import axios from 'axios';
import { OrderIngestListener } from './order-ingest.listener';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('OrderIngestListener.onShipment', () => {
  let listener: OrderIngestListener;
  let ingest: { ingest: jest.Mock };
  let marketplaceService: { findByTag: jest.Mock };
  let mlAuth: { getValidToken: jest.Mock };
  let broker: { resolveAccountByExternalUserId: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    ingest = { ingest: jest.fn().mockResolvedValue(undefined) };
    marketplaceService = { findByTag: jest.fn().mockResolvedValue({ _id: 'mkt-1' }) };
    mlAuth = { getValidToken: jest.fn().mockResolvedValue('TOKEN-123') };
    broker = { resolveAccountByExternalUserId: jest.fn() };

    listener = new OrderIngestListener(ingest as any, marketplaceService as any, mlAuth as any, broker as any);
  });

  it('resolve shipment→order via GET /shipments/{id} e reingesta o pedido dono', async () => {
    mockedAxios.get.mockResolvedValue({ data: { order_id: 2000018119021276 } });

    await listener.onShipment({
      marketplace: 'mercadolivre',
      externalShipmentId: '47856425023',
      externalUserId: null,
      resource: '/shipments/47856425023',
      receivedAt: new Date(),
      source: 'webhook',
    });

    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://api.mercadolibre.com/shipments/47856425023',
      expect.objectContaining({ headers: { Authorization: 'Bearer TOKEN-123' } }),
    );
    expect(ingest.ingest).toHaveBeenCalledWith('2000018119021276', 'mkt-1', 'webhook', undefined);
  });

  it('não reingesta quando GET /shipments/{id} não retorna order_id', async () => {
    mockedAxios.get.mockResolvedValue({ data: {} });

    await listener.onShipment({
      marketplace: 'mercadolivre',
      externalShipmentId: '47856425023',
      externalUserId: null,
      resource: '/shipments/47856425023',
      receivedAt: new Date(),
      source: 'webhook',
    });

    expect(ingest.ingest).not.toHaveBeenCalled();
  });

  it('não reingesta quando a chamada à API do ML falha', async () => {
    mockedAxios.get.mockRejectedValue(new Error('timeout'));

    await listener.onShipment({
      marketplace: 'mercadolivre',
      externalShipmentId: '47856425023',
      externalUserId: null,
      resource: '/shipments/47856425023',
      receivedAt: new Date(),
      source: 'webhook',
    });

    expect(ingest.ingest).not.toHaveBeenCalled();
  });

  it('roteia pela conta certa (multi-client) quando externalUserId casa uma conta', async () => {
    broker.resolveAccountByExternalUserId.mockResolvedValue({ accountId: 'ACC_A' });
    mockedAxios.get.mockResolvedValue({ data: { order_id: 999 } });

    await listener.onShipment({
      marketplace: 'mercadolivre',
      externalShipmentId: '47856425023',
      externalUserId: '3475525806',
      resource: '/shipments/47856425023',
      receivedAt: new Date(),
      source: 'webhook',
    });

    expect(mlAuth.getValidToken).toHaveBeenCalledWith('Mercado Livre', { accountId: 'ACC_A' });
    expect(ingest.ingest).toHaveBeenCalledWith('999', 'mkt-1', 'webhook', 'ACC_A');
  });

  it('falha fechada: externalUserId que não casa nenhuma conta não roteia para a conta default', async () => {
    broker.resolveAccountByExternalUserId.mockResolvedValue(null);

    await listener.onShipment({
      marketplace: 'mercadolivre',
      externalShipmentId: '47856425023',
      externalUserId: '999999999',
      resource: '/shipments/47856425023',
      receivedAt: new Date(),
      source: 'webhook',
    });

    expect(mockedAxios.get).not.toHaveBeenCalled();
    expect(ingest.ingest).not.toHaveBeenCalled();
  });
});
