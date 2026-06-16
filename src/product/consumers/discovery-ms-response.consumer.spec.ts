import { DiscoveryMsResponseConsumer } from './discovery-ms-response.consumer';

describe('DiscoveryMsResponseConsumer — sources.menorPreco', () => {
    function makeConsumer() {
        const setCalls: any[] = [];
        const discoveryModel: any = {
            findOne: jest.fn().mockReturnValue({
                select: () => ({ lean: () => ({ exec: async () => ({ isActiveIntent: true, status: 'pending' }) }) }),
            }),
            updateOne: jest.fn().mockImplementation((_filter: any, update: any) => {
                if (update?.$set) setCalls.push(update.$set);
                return { exec: async () => undefined };
            }),
        };
        const eventEmitter = { emit: jest.fn() };
        const categoryResolution = { resolve: jest.fn().mockResolvedValue(null) };
        const consumer = new DiscoveryMsResponseConsumer(
            discoveryModel, eventEmitter as any, categoryResolution as any,
        );
        return { consumer, setCalls };
    }

    it('persiste sources.menorPreco a partir de results.menorPreco', async () => {
        const { consumer, setCalls } = makeConsumer();
        await consumer.handleResponse({
            jobId: 'job1',
            status: 'completed',
            scrapedAt: new Date().toISOString(),
            results: {
                mercadolivre: { items: [] },
                serp: { items: [] },
                menorPreco: {
                    stats: { min: 1, avg: 2, max: 3, count: 2 },
                    offers: [{ seller_name: 'LOJA', uf: 'PE', price: 1 }],
                },
            },
        });

        const persisted = setCalls.find((s) => s.sources)?.sources;
        expect(persisted).toBeDefined();
        expect(persisted.menorPreco.stats.count).toBe(2);
        expect(persisted.menorPreco.offers[0].seller_name).toBe('LOJA');
        expect(persisted.menorPreco.confidence).toBe('high');
    });

    it('menorPreco confidence none e offers vazias quando results não traz menorPreco', async () => {
        const { consumer, setCalls } = makeConsumer();
        await consumer.handleResponse({
            jobId: 'job2',
            status: 'completed',
            scrapedAt: new Date().toISOString(),
            results: { mercadolivre: { items: [] }, serp: { items: [] } },
        });

        const persisted = setCalls.find((s) => s.sources)?.sources;
        expect(persisted.menorPreco.offers).toEqual([]);
        expect(persisted.menorPreco.confidence).toBe('none');
    });
});
