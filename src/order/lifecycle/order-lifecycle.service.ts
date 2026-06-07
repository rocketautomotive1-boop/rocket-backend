import { Injectable, Logger } from '@nestjs/common';
import { OrderDocument } from '../schemas/order.schema';
import { OrderRepository } from '../order.repository';
import { Result } from '../../common/utils/result.util';

/**
 * Administrative lifecycle of an order: notes, embedded logs, ignore.
 * Pure order-domain writes — depends only on OrderRepository.
 */
@Injectable()
export class OrderLifecycleService {
    private readonly logger = new Logger(OrderLifecycleService.name);

    constructor(private readonly orderRepository: OrderRepository) { }

    /**
     * Creates an order directly (e.g. B2C web-store checkout), bypassing marketplace ingest.
     * Kept minimal — embeds a customer snapshot and the cart items.
     */
    async createDirectOrder(
        customerId: number,
        items: any[],
        paymentData: { paymentMethod?: string; transactionId?: string; shippingCost?: number },
    ): Promise<OrderDocument> {
        const customerSnapshot = {
            name: 'Cliente Web',
            document: '00000000000',
            email: 'web@store.com',
            phone: '',
            address: { zipCode: '', street: '', number: '', neighborhood: '', city: '', state: '' },
        };

        const orderItems = items.map(item => ({
            title: item.product?.name || 'Produto Web',
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            productId: item.productId,
        }));

        const order = await this.orderRepository.create({
            status: 'PENDING',
            marketplaceId: 9999,
            externalId: `WEB-${Date.now()}`,
            customer: customerSnapshot,
            items: orderItems,
            totalAmount: items.reduce((acc, item) => acc + (Number(item.unitPrice) * item.quantity), 0),
            shippingAmount: paymentData.shippingCost ?? 0,
            createdAt: new Date(),
            logs: [],
        });

        await this.createLog(order.externalId, 'CREATE', 'Pedido criado via Loja Virtual', {
            customerId,
            paymentMethod: paymentData.paymentMethod,
            transactionId: paymentData.transactionId,
        });

        return order;
    }

    async addNote(id: string, message: string, user = 'User'): Promise<Result<OrderDocument>> {
        const order = await this.resolve(id);
        if (!order) return Result.fail('Order not found');
        await this.createLog(id, 'NOTE', message, { user });
        const refreshed = await this.resolve(id);
        return refreshed ? Result.ok(refreshed) : Result.fail('Order not found');
    }

    async ignoreOrder(id: string, userId: string): Promise<Result<void>> {
        const order = await this.resolve(id);
        if (!order) return Result.fail('Order not found');
        order.status = 'ignored';
        await this.createLog(id, 'IGNORE', 'Pedido ignorado pelo usuário', { user: userId });
        await this.orderRepository.save(order);
        return Result.ok();
    }

    async createLog(orderId: any, type: string, message: string, details?: any): Promise<void> {
        let query: any = {};
        if (typeof orderId === 'object' && orderId._id) {
            query = { _id: orderId._id };
        } else if (typeof orderId === 'string' && orderId.match(/^[0-9a-fA-F]{24}$/)) {
            query = { _id: orderId };
        } else {
            query = { externalId: orderId };
        }

        await this.orderRepository.updateOne(query, {
            $push: {
                logs: { logType: type, message, details, createdAt: new Date() },
            },
        });
    }

    private async resolve(id: string): Promise<OrderDocument | null> {
        if (id.match(/^[0-9a-fA-F]{24}$/)) {
            const byId = await this.orderRepository.findById(id);
            if (byId) return byId;
        }
        return this.orderRepository.findByExternalId(id);
    }
}
