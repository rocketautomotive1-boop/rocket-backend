import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OutboxMessage, OutboxMessageSchema } from './schemas/outbox-message.schema';
import { OutboxRepository } from './outbox.repository';
import { OutboxRelayService } from './outbox-relay.service';
import { OrchestratorPublisherService } from '../marketplace-orchestrator/orchestrator-publisher.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: OutboxMessage.name, schema: OutboxMessageSchema }]),
  ],
  providers: [OutboxRepository, OutboxRelayService, OrchestratorPublisherService],
  exports: [OrchestratorPublisherService, OutboxRepository],
})
export class OutboxModule {}
