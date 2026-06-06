import { Injectable, OnModuleInit } from '@nestjs/common';
import { DiscoveryService, Reflector } from '@nestjs/core';
import { WebhookAdapter, WEBHOOK_ADAPTER_METADATA } from './webhook-adapter.interface';
@Injectable()
export class WebhookAdapterRegistry implements OnModuleInit {
  private readonly adapters = new Map<string, WebhookAdapter>();
  constructor(private readonly discovery: DiscoveryService, private readonly reflector: Reflector) {}
  onModuleInit(): void {
    for (const wrapper of this.discovery.getProviders()) {
      const instance:any = wrapper.instance;
      if (!instance || !instance.constructor) continue;
      const marketplace = this.reflector.get<string>(WEBHOOK_ADAPTER_METADATA, instance.constructor);
      if (marketplace) this.adapters.set(marketplace, instance as WebhookAdapter);
    }
  }
  get(marketplace: string): WebhookAdapter | undefined { return this.adapters.get(marketplace); }
  has(marketplace: string): boolean { return this.adapters.has(marketplace); }
  list(): string[] { return [...this.adapters.keys()]; }
}
