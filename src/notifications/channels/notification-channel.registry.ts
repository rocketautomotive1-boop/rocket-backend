import { Injectable, OnModuleInit } from '@nestjs/common';
import { DiscoveryService, Reflector } from '@nestjs/core';
import { NotificationChannelKey } from '../contracts/notification.types';
import { NotificationChannel, NOTIFICATION_CHANNEL_METADATA } from './notification-channel.interface';

@Injectable()
export class NotificationChannelRegistry implements OnModuleInit {
  private readonly channels = new Map<string, NotificationChannel>();

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly reflector: Reflector,
  ) {}

  onModuleInit(): void {
    for (const wrapper of this.discovery.getProviders()) {
      const instance: any = wrapper.instance;
      if (!instance || !instance.constructor) continue;
      const key = this.reflector.get<NotificationChannelKey>(
        NOTIFICATION_CHANNEL_METADATA, instance.constructor,
      );
      if (key) this.channels.set(key, instance as NotificationChannel);
    }
  }

  get(key: NotificationChannelKey): NotificationChannel | undefined {
    return this.channels.get(key);
  }
  has(key: NotificationChannelKey): boolean { return this.channels.has(key); }
  list(): string[] { return [...this.channels.keys()]; }
}
