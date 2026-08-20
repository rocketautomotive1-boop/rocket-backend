import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { RocketOrderAdapter } from './rocket-order.adapter';
import { MarketplaceAdapterRegistry } from '../../registries/marketplace-adapter.registry';
import { BalcaoOrderDraftModel } from '../../../order/schemas/balcao-order-draft.schema';

describe('RocketOrderAdapter', () => {
    let adapter: RocketOrderAdapter;
    const registry = { registerOrderAdapter: jest.fn() };
    const draftModel = { findOne: jest.fn() };

    beforeEach(async () => {
        jest.clearAllMocks();
        const moduleRef = await Test.createTestingModule({
            providers: [
                RocketOrderAdapter,
                { provide: MarketplaceAdapterRegistry, useValue: registry },
                { provide: getModelToken(BalcaoOrderDraftModel.name), useValue: draftModel },
            ],
        }).compile();
        adapter = moduleRef.get(RocketOrderAdapter);
    });

    it('registers itself as the "Rocket" order adapter on module init', () => {
        adapter.onModuleInit();
        expect(registry.registerOrderAdapter).toHaveBeenCalledWith('Rocket', adapter);
    });

    it('getOrderDetails reads the pending draft, maps items, and marks it processed', async () => {
        const updateOne = jest.fn().mockResolvedValue(undefined);
        draftModel.findOne.mockResolvedValue({
            data: {
                items: [
                    { productId: '507f1f77bcf86cd799439011', title: 'Filtro de óleo', quantity: 2, unitPrice: 25 },
                ],
            },
            updateOne,
        });

        const out = await adapter.getOrderDetails('BALCAO-123');

        expect(draftModel.findOne).toHaveBeenCalledWith({ externalId: 'BALCAO-123', status: 'pending' });
        expect(out.status).toBe('paid');
        expect(out.total_amount).toBe(50);
        expect(out.items).toEqual([
            {
                id: '507f1f77bcf86cd799439011',
                sku: '507f1f77bcf86cd799439011',
                title: 'Filtro de óleo',
                quantity: 2,
                unit_price: 25,
            },
        ]);
        expect(updateOne).toHaveBeenCalledWith({ status: 'processed' });
    });

    it('getOrderDetails throws NotFoundException when no pending draft exists', async () => {
        draftModel.findOne.mockResolvedValue(null);
        await expect(adapter.getOrderDetails('BALCAO-missing')).rejects.toThrow(NotFoundException);
    });
});
