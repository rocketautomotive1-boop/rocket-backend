import { Injectable, Logger } from '@nestjs/common';
import { OrderDocument } from '../schemas/order.schema';
import { OrderRepository } from '../order.repository';
import { Result } from '../../common/utils/result.util';
import { CustomerDocument } from '../../customer/schemas/customer.schema';

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
        customer: CustomerDocument,
        items: any[],
        paymentData: { paymentMethod?: string; transactionId?: string; mpStatus?: string; shippingCost?: number; discountAmount?: number; shippingAddress?: any },
    ): Promise<OrderDocument> {
        const defaultAddress = customer.addresses?.find(a => a.isDefault) ?? customer.addresses?.[0];
        const address = paymentData.shippingAddress ?? {
            zipCode: defaultAddress?.zipCode ?? '',
            street: defaultAddress?.street ?? '',
            number: defaultAddress?.number ?? '',
            neighborhood: defaultAddress?.neighborhood ?? '',
            city: defaultAddress?.city ?? '',
            state: defaultAddress?.state ?? '',
        };

        const customerSnapshot = {
            customerId: customer._id,
            name: customer.name,
            document: customer.document ?? '',
            email: customer.email,
            phone: customer.phone ?? '',
            address,
        };

        const orderItems = items.map(item => ({
            title: item.product?.name || 'Produto Web',
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            productId: item.productId,
        }));

        const discountAmount = paymentData.discountAmount ?? 0;
        const itemsSubtotal = items.reduce((acc, item) => acc + (Number(item.unitPrice) * item.quantity), 0);

        const order = await this.orderRepository.create({
            status: 'PENDING',
            marketplaceId: 9999,
            externalId: `WEB-${Date.now()}`,
            customer: customerSnapshot,
            items: orderItems,
            totalAmount: Math.max(0, itemsSubtotal - discountAmount),
            shippingAmount: paymentData.shippingCost ?? 0,
            discountAmount,
            payment: {
                method: paymentData.paymentMethod,
                mpPaymentId: paymentData.transactionId,
                mpStatus: paymentData.mpStatus,
            } as any,
            createdAt: new Date(),
            logs: [],
        });

        await this.createLog(order.externalId, 'CREATE', 'Pedido criado via Loja Virtual', {
            customerId: String(customer._id),
            paymentMethod: paymentData.paymentMethod,
            transactionId: paymentData.transactionId,
        });

        return order;
    }

    /**
     * Chamado pelo webhook do Mercado Pago quando um pagamento assíncrono (Pix/boleto)
     * muda de status. Encontra o pedido pelo payment.mpPaymentId e atualiza status
     * comercial + payment.mpStatus. Idempotente — reaplicar o mesmo status é no-op seguro.
     */
    async confirmPaymentByMpId(mpPaymentId: string, mpStatus: string): Promise<Result<OrderDocument>> {
        const order = await this.orderRepository.findOne({ 'payment.mpPaymentId': mpPaymentId });
        if (!order) return Result.fail(`Pedido não encontrado para pagamento MP ${mpPaymentId}`);

        order.payment = { ...(order.payment as any), mpStatus };
        if (mpStatus === 'approved' && order.status !== 'PAID') {
            order.status = 'PAID';
        } else if (mpStatus === 'rejected' || mpStatus === 'cancelled') {
            order.status = 'CANCELLED';
        }
        await this.orderRepository.save(order);
        await this.createLog(order, 'PAYMENT_UPDATE', `Status do pagamento MP atualizado: ${mpStatus}`, { mpPaymentId, mpStatus });

        return Result.ok(order);
    }

    /**
     * Avanço manual do status comercial de um pedido B2C (loja virtual) — não existe
     * rastreamento de transportadora integrado ainda, então SHIPPED/DELIVERED são
     * marcados manualmente pelo time interno via admin. Nunca regride o status
     * (mesma regra do Unified Order Model: PENDING → PAID → SHIPPED → DELIVERED).
     */
    async updateShippingStatus(id: string, status: 'SHIPPED' | 'DELIVERED', userId = 'admin'): Promise<Result<OrderDocument>> {
        const order = await this.resolve(id);
        if (!order) return Result.fail('Order not found');

        const rank = { PENDING: 0, PAID: 1, SHIPPED: 2, DELIVERED: 3, CANCELLED: -1 } as Record<string, number>;
        const currentRank = rank[order.status] ?? 0;
        const nextRank = rank[status];

        if (nextRank <= currentRank) {
            return Result.fail(`Não é possível mover o pedido de '${order.status}' para '${status}'.`);
        }

        order.status = status;
        if (status === 'DELIVERED') {
            order.shipping = { ...(order.shipping as any), deliveredAt: new Date() };
        }
        await this.orderRepository.save(order);
        await this.createLog(order, 'STATUS_UPDATE', `Status atualizado manualmente para ${status}`, { user: userId });

        return Result.ok(order);
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
