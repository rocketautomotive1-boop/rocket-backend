import axios from 'axios';
import * as AdmZip from 'adm-zip';
import { NotFoundException } from '@nestjs/common';
import { OrderLabelService } from './order-label.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

function buildZplZip(zplText: string): Buffer {
    const zip = new AdmZip();
    zip.addFile('Etiqueta de envio.txt', Buffer.from(zplText, 'utf-8'));
    return zip.toBuffer();
}

describe('OrderLabelService', () => {
    let service: OrderLabelService;
    let orderModel: any;
    let configCache: any;
    let auth: any;
    let signer: any;

    const marketplace = { _id: 'mkt-1', tag: 'mercadolivre', name: 'Mercado Livre' };
    const order = {
        _id: 'order-1',
        externalId: '2000018033874934',
        marketplaceId: 'mkt-1',
        accountId: 'acc-maxeshop',
    };
    const token = { accessToken: 'TOKEN-123' };

    beforeEach(() => {
        jest.clearAllMocks();

        orderModel = { findById: jest.fn().mockReturnValue({ lean: () => ({ exec: () => Promise.resolve(order) }) }) };
        configCache = { getById: jest.fn().mockResolvedValue(marketplace) };
        auth = { ensureValidToken: jest.fn().mockResolvedValue(token) };
        signer = { buildSignedParams: jest.fn() };

        service = new OrderLabelService(orderModel, configCache, auth, signer);
    });

    it('bloqueia impressão de etiqueta quando o shipment está em prazo de expedição ao vivo (status/substatus pending/buffered)', async () => {
        mockedAxios.get.mockImplementation((url: string) => {
            if (url.includes('/orders/')) return Promise.resolve({ data: { shipping: { id: 47816652986 } } });
            if (url.includes('/shipments/')) return Promise.resolve({ data: { status: 'pending', substatus: 'buffered' } });
            return Promise.reject(new Error('unexpected url ' + url));
        });

        await expect(service.getLabel('order-1')).rejects.toThrow(/prazo de expedição/i);
        expect(configCache.getById).toHaveBeenCalled(); // já resolveu marketplace antes do gate ao vivo
    });

    it('resolve o token pela conta dona do pedido, não pela default do marketplace', async () => {
        mockedAxios.get.mockImplementation((url: string) => {
            if (url.includes('/orders/')) return Promise.resolve({ data: { shipping: { id: 999 } } });
            if (url.includes('/shipments/')) return Promise.resolve({ data: { status: 'ready_to_ship', substatus: 'ready_to_print' } });
            if (url.includes('/shipment_labels')) return Promise.resolve({ data: buildZplZip('^XA^FS') });
            return Promise.reject(new Error('unexpected url ' + url));
        });

        await service.getLabel('order-1');

        expect(auth.ensureValidToken).toHaveBeenCalledWith('mkt-1', { accountId: 'acc-maxeshop' });
    });

    it('busca o shipmentId ao vivo em GET /orders/{externalId} (não persistido no schema)', async () => {
        mockedAxios.get.mockImplementation((url: string) => {
            if (url === 'https://api.mercadolibre.com/orders/2000018033874934') {
                return Promise.resolve({ data: { shipping: { id: 47816652986 } } });
            }
            if (url.includes('/shipments/')) return Promise.resolve({ data: { status: 'ready_to_ship', substatus: 'ready_to_print' } });
            if (url.includes('/shipment_labels')) return Promise.resolve({ data: buildZplZip('^XA^FS') });
            return Promise.reject(new Error('unexpected url ' + url));
        });

        await service.getLabel('order-1');

        expect(mockedAxios.get).toHaveBeenCalledWith(
            'https://api.mercadolibre.com/orders/2000018033874934',
            expect.objectContaining({ headers: { Authorization: 'Bearer TOKEN-123' } }),
        );
    });

    it('usa o endpoint correto /shipment_labels (plural, query shipment_ids) e extrai o ZPL do ZIP', async () => {
        const zpl = '^XA\n^FO20,10^GFA...\n^XZ';
        mockedAxios.get.mockImplementation((url: string) => {
            if (url.includes('/orders/')) return Promise.resolve({ data: { shipping: { id: 47816652986 } } });
            if (url.includes('/shipments/')) return Promise.resolve({ data: { status: 'ready_to_ship', substatus: 'ready_to_print' } });
            if (url === 'https://api.mercadolibre.com/shipment_labels') {
                return Promise.resolve({ data: buildZplZip(zpl) });
            }
            return Promise.reject(new Error('unexpected url ' + url));
        });

        const result = await service.getLabel('order-1');

        expect(mockedAxios.get).toHaveBeenCalledWith(
            'https://api.mercadolibre.com/shipment_labels',
            expect.objectContaining({
                params: { shipment_ids: 47816652986, response_type: 'zpl2' },
                responseType: 'arraybuffer',
            }),
        );
        expect(result).toEqual({ format: 'zpl', content: zpl, marketplace: 'mercadolivre' });
    });

    it('cai para PDF quando ZPL falha (ex: NOT_PRINTABLE_STATUS)', async () => {
        const mlError = {
            failed_shipments: [{ shipment_id: '47816652986', message: 'Shipment 47816652986 status is delivered', cause: 'NOT_PRINTABLE_STATUS' }],
        };
        mockedAxios.get.mockImplementation((url: string, config?: any) => {
            if (url.includes('/orders/')) return Promise.resolve({ data: { shipping: { id: 47816652986 } } });
            if (url.includes('/shipments/')) return Promise.resolve({ data: { status: 'delivered', substatus: null } });
            if (url === 'https://api.mercadolibre.com/shipment_labels') {
                if (config?.params?.response_type === 'zpl2') {
                    return Promise.reject({ response: { data: Buffer.from(JSON.stringify(mlError)) } });
                }
                return Promise.resolve({ data: Buffer.from('%PDF-1.6 fake') });
            }
            return Promise.reject(new Error('unexpected url ' + url));
        });

        const result = await service.getLabel('order-1');

        expect(result.format).toBe('pdf');
        expect(result.url).toMatch(/^data:application\/pdf;base64,/);
    });

    it('propaga a mensagem de erro do ML quando nem ZPL nem PDF funcionam', async () => {
        const mlError = {
            failed_shipments: [{ shipment_id: '47816652986', message: 'Shipment 47816652986 status is delivered', cause: 'NOT_PRINTABLE_STATUS' }],
        };
        mockedAxios.get.mockImplementation((url: string) => {
            if (url.includes('/orders/')) return Promise.resolve({ data: { shipping: { id: 47816652986 } } });
            if (url.includes('/shipments/')) return Promise.resolve({ data: { status: 'delivered', substatus: null } });
            if (url === 'https://api.mercadolibre.com/shipment_labels') {
                return Promise.reject({ response: { data: Buffer.from(JSON.stringify(mlError)) } });
            }
            return Promise.reject(new Error('unexpected url ' + url));
        });

        await expect(service.getLabel('order-1')).rejects.toThrow(/status is delivered/);
    });

    it('lança NotFoundException quando o pedido não tem shipping.id no ML', async () => {
        mockedAxios.get.mockImplementation((url: string) => {
            if (url.includes('/orders/')) return Promise.resolve({ data: {} });
            return Promise.reject(new Error('unexpected url ' + url));
        });

        await expect(service.getLabel('order-1')).rejects.toThrow(NotFoundException);
    });
});
