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
        const categoryResolution = {
            resolve: jest.fn().mockResolvedValue(null),
            resolveByExternalId: jest.fn().mockResolvedValue(null),
        };
        const consumer = new DiscoveryMsResponseConsumer(
            discoveryModel, eventEmitter as any, categoryResolution as any,
        );
        return { consumer, setCalls, eventEmitter };
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

    it('emite queue.job.update no contrato normalizado (DiscoveryAppData), não no shape cru', async () => {
        const { consumer, eventEmitter } = makeConsumer();
        await consumer.handleResponse({
            jobId: 'job3',
            status: 'completed',
            scrapedAt: new Date().toISOString(),
            results: {
                titles: ['Filtro X'],
                mercadolivre: {
                    items: [{ id: 'MLB1', images: ['http://img/1.jpg'] }],
                    breadcrumb: 'Acessórios > Filtros',
                },
                serp: { items: [] },
            },
        });

        const completion = (eventEmitter.emit as jest.Mock).mock.calls.find(
            ([name, ev]) => name === 'queue.job.update' && ev?.status === 'COMPLETED',
        );
        expect(completion).toBeDefined();
        const result = completion![1].result;

        // Contrato único: chaves normalizadas, sem dialeto cru.
        expect(result.titles).toEqual(['Filtro X']);
        expect(result.breadcrumbPath).toBe('Acessórios > Filtros');
        expect(result.winningSource).toBe('mercadolivre'); // não `preferredSource`
        expect(result.rawItems).toHaveLength(1);
        expect(result).not.toHaveProperty('preferredSource');
        expect(result).not.toHaveProperty('breadcrumb');
    });

    it('persiste no Mongo mas NÃO emite queue.job.update quando lateArrival=true', async () => {
        const { consumer, setCalls, eventEmitter } = makeConsumer();
        await consumer.handleResponse({
            jobId: 'job4',
            status: 'completed',
            scrapedAt: new Date().toISOString(),
            lateArrival: true,
            results: {
                titles: ['Filtro X (real ML)'],
                mercadolivre: { items: [{ id: 'MLB1', images: [] }] },
                serp: { items: [] },
            },
        });

        const persisted = setCalls.find((s) => s.sources)?.sources;
        expect(persisted?.mercadolivre.items).toHaveLength(1);
        expect(eventEmitter.emit).not.toHaveBeenCalledWith(
            'queue.job.update',
            expect.objectContaining({ jobId: 'job4' }),
        );
    });
});
