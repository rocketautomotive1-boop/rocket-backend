import { Injectable, Logger } from '@nestjs/common';
import { ModerationHandler } from './moderation-handler.interface';
import { ModerationType } from '../providers/moderation-provider.types';
import { WrongCategoryHandler } from './wrong-category.handler';
import { MissingCompatibilityHandler } from './missing-compatibility.handler';

/**
 * Maps a canonical ModerationType to its handler. New moderation types add a handler here —
 * the ingest pipeline stays untouched.
 */
@Injectable()
export class ModerationHandlerRegistry {
  private readonly logger = new Logger(ModerationHandlerRegistry.name);
  private readonly handlers = new Map<ModerationType, ModerationHandler>();

  constructor(
    wrongCategory: WrongCategoryHandler,
    missingCompatibility: MissingCompatibilityHandler,
  ) {
    this.register(wrongCategory);
    this.register(missingCompatibility);
    this.logger.log(`Moderation handlers: [${[...this.handlers.keys()].join(', ')}]`);
  }

  private register(handler: ModerationHandler): void {
    this.handlers.set(handler.type, handler);
  }

  get(type: ModerationType): ModerationHandler | undefined {
    return this.handlers.get(type);
  }
}
