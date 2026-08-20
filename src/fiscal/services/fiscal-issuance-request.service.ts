import { Injectable, Logger, NotFoundException, Inject } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { FiscalDocumentModel, FiscalDocumentDocument } from '../schemas/fiscal.schema';
import { OrderModel, OrderDocument } from '../../order/schemas/order.schema';
import { OutboxRepository } from '../../outbox/outbox.repository';

export const FISCAL_ISSUANCE_EXCHANGE = 'rocket.fiscal';
export const FISCAL_ISSUANCE_ROUTING_KEY = 'nfe.emit.requested';

export type FiscalIssuanceRequestResult =
    | { status: 'QUEUED' }
    | { status: 'ALREADY_ISSUED'; nfeId: string };

/**
 * Ponto de entrada único para emissão de NFe — enfileira via outbox em vez de emitir
 * dentro do request/evento que a disparou. Consumido por FiscalIssuanceConsumer.
 * Ver docs/superpowers/specs/2026-08-19-fiscal-issuance-async-postemission-design.md.
 */
@Injectable()
export class FiscalIssuanceRequestService {
    private readonly logger = new Logger(FiscalIssuanceRequestService.name);

    constructor(
        @InjectModel(FiscalDocumentModel.name)
        private readonly fiscalDocumentModel: Model<FiscalDocumentDocument>,
        @InjectModel(OrderModel.name)
        private readonly orderModel: Model<OrderDocument>,
        private readonly outbox: OutboxRepository,
    ) { }

    async request(orderId: string, overrides: any = {}): Promise<FiscalIssuanceRequestResult> {
        const internalOrderId = await this.resolveInternalOrderId(orderId);

        if (internalOrderId) {
            const existing = await this.fiscalDocumentModel
                .findOne({
                    $or: [{ orderId: internalOrderId }, { order: internalOrderId }],
                    status: { $in: ['AUTHORIZED', 'PROCESSING'] },
                })
                .lean()
                .exec();
            if (existing) {
                return { status: 'ALREADY_ISSUED', nfeId: String((existing as any)._id) };
            }
        }

        await this.outbox.enqueue({
            exchange: FISCAL_ISSUANCE_EXCHANGE,
            routingKey: FISCAL_ISSUANCE_ROUTING_KEY,
            payload: { orderId, overrides, requestedAt: new Date().toISOString() },
        });
        this.logger.log(`NFe emit enfileirada para pedido ${orderId}`);
        return { status: 'QUEUED' };
    }

    private async resolveInternalOrderId(orderId: string): Promise<Types.ObjectId | null> {
        const IS_MONGO_ID = /^[0-9a-fA-F]{24}$/;
        if (IS_MONGO_ID.test(orderId)) return new Types.ObjectId(orderId);
        const dbOrder = await this.orderModel.findOne({ externalId: orderId }).select('_id').lean().exec();
        return dbOrder ? (dbOrder as any)._id : null;
    }
}
