import { WebhookAdapterRegistry } from './webhook-adapter.registry';
import { RegisterWebhookAdapter, WEBHOOK_ADAPTER_METADATA } from './webhook-adapter.interface';

@RegisterWebhookAdapter('mercadolivre')
class MlFake { marketplace='mercadolivre'; signatureScheme={type:'none' as const}; parse(){ return {} as any; } }

describe('WebhookAdapterRegistry', () => {
  const makeSut = (instances:any[]) => {
    const discovery = { getProviders: () => instances.map((instance)=>({ instance, metatype: instance?.constructor })) };
    const reflector = { get: (_k:string,t:any)=> Reflect.getMetadata(WEBHOOK_ADAPTER_METADATA, t) };
    return new WebhookAdapterRegistry(discovery as any, reflector as any);
  };
  it('indexa adapters decorados e resolve por nome', () => {
    const ml = new MlFake();
    const sut = makeSut([ml, {}, null]);
    sut.onModuleInit();
    expect(sut.has('mercadolivre')).toBe(true);
    expect(sut.get('mercadolivre')).toBe(ml);
    expect(sut.get('inexistente')).toBeUndefined();
  });
});
