
import { Injectable, Logger, NotFoundException, BadRequestException, Inject } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CartModel, CartDocument } from './schemas/cart.schema';
import { ProductService } from '../product/product.service';
import { ProductRepository } from '../product/product.repository';
import { AddToCartDto } from './dto/add-to-cart.dto';
import { CouponModel, CouponDocument } from './schemas/coupon.schema';
import { CouponRedemptionModel, CouponRedemptionDocument } from './schemas/coupon-redemption.schema';
import { CustomerService } from '../customer/customer.service'; // Assuming path for CustomerService
import { STOCK_QUERY_PORT, StockQueryPort } from '../stock/ports/stock-query.port';
import { PRICING_PORT, PricingPort } from '../pricing/ports/pricing.port';

@Injectable()
export class CartService {
    constructor(
        @InjectModel(CartModel.name) private cartModel: Model<CartDocument>,
        @InjectModel('CouponModel') private couponModel: Model<CouponDocument>, // Corrected type and name
        @InjectModel(CouponRedemptionModel.name) private couponRedemptionModel: Model<CouponRedemptionDocument>,
        private readonly productService: ProductService,
        private readonly productRepository: ProductRepository,
        private readonly customerService: CustomerService,
        @Inject(STOCK_QUERY_PORT) private readonly stockQuery: StockQueryPort,
        @Inject(PRICING_PORT) private readonly pricing: PricingPort,
    ) { }

    /** true se o produto do item cai no escopo do cupom (categoryIds/productIds vazios = elegível). */
    private isItemEligibleForCoupon(coupon: CouponDocument, item: any, categoryIdByProduct: Map<string, string>): boolean {
        const hasProductScope = !!coupon.productIds?.length;
        const hasCategoryScope = !!coupon.categoryIds?.length;
        if (!hasProductScope && !hasCategoryScope) return true;

        if (hasProductScope && coupon.productIds!.includes(String(item.productId))) return true;

        if (hasCategoryScope) {
            const categoryId = categoryIdByProduct.get(String(item.productId));
            if (categoryId && coupon.categoryIds!.includes(categoryId)) return true;
        }

        return false;
    }

    async applyCoupon(customerId: string | null, sessionId: string | null, code: string): Promise<CartDocument> {
        const coupon = await this.couponModel.findOne({ code: code.toUpperCase(), isActive: true });
        if (!coupon) {
            throw new BadRequestException('Cupom inválido ou expirado.');
        }

        if (coupon.expirationDate && new Date() > coupon.expirationDate) {
            throw new BadRequestException('Este cupom expirou.');
        }

        if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) {
            throw new BadRequestException('Este cupom atingiu o limite de uso.');
        }

        const cart = await this.findOrCreateCart(customerId || undefined, sessionId || undefined);

        const categoryIdByProduct = new Map<string, string>();
        if (coupon.categoryIds?.length) {
            for (const item of cart.items) {
                const product = await this.productService.findOne(String(item.productId)).catch(() => null);
                const categoryId = (product as any)?.category ? String((product as any).category) : undefined;
                if (categoryId) categoryIdByProduct.set(String(item.productId), categoryId);
            }
        }

        let subtotal = 0;
        let eligibleSubtotal = 0;
        for (const item of cart.items) {
            const itemTotal = Number(item.unitPrice) * item.quantity;
            subtotal += itemTotal;
            if (this.isItemEligibleForCoupon(coupon, item, categoryIdByProduct)) {
                eligibleSubtotal += itemTotal;
            }
        }

        if (eligibleSubtotal === 0) {
            throw new BadRequestException('Nenhum item do carrinho é elegível para este cupom.');
        }

        if (coupon.minPurchase && subtotal < coupon.minPurchase) {
            throw new BadRequestException(`Valor mínimo para este cupom é R$ ${coupon.minPurchase} `);
        }

        let discount = 0;
        if (coupon.type === 'PERCENTAGE') {
            discount = (eligibleSubtotal * coupon.value) / 100;
        } else {
            discount = coupon.value;
        }

        // Desconto nunca ultrapassa o subtotal elegível (mesmo cupom FIXED "generoso" demais).
        if (discount > eligibleSubtotal) discount = eligibleSubtotal;

        cart.couponCode = coupon.code;
        cart.discountAmount = discount;

        return cart.save();
    }

    async findOrCreateCart(customerId?: string, sessionId?: string): Promise<CartDocument> {
        let query: any = {};
        if (customerId) {
            query.customerId = customerId;
        } else if (sessionId) {
            query.sessionId = sessionId;
        } else {
            throw new Error('Customer ID or Session ID required');
        }

        // Find active OR abandoned
        query.status = { $in: ['active', 'abandoned'] };

        let cart = await this.cartModel.findOne(query).exec();

        // If cart is abandoned, reactivate it on interaction
        if (cart && cart.status === 'abandoned') {
            cart.status = 'active';
            await cart.save();
        }

        if (!cart) {
            cart = new this.cartModel({
                customerId,
                sessionId,
                status: 'active',
                items: []
            });
            await cart.save();
        }

        return cart;
    }

    async addToCart(customerId: string | null, sessionId: string | null, addToCartDto: AddToCartDto): Promise<any> {
        const cart = await this.findOrCreateCart(customerId || undefined, sessionId || undefined);

        // Check product stock
        const productId = String(addToCartDto.productId); // Ensure string
        const product = await this.productService.findOne(productId); // Supports string/number
        if (!product) {
            throw new NotFoundException('Product not found');
        }

        const existingItemIndex = cart.items.findIndex(i => String(i.productId) === productId);
        let newTotalQuantity = addToCartDto.quantity;

        if (existingItemIndex > -1) {
            newTotalQuantity += cart.items[existingItemIndex].quantity;
        }

        // Validate Stock (real-time from stock_movements)
        const stock = (await this.stockQuery.getProductStock(productId)).available;
        if (newTotalQuantity > stock) {
            throw new BadRequestException(`Apenas ${stock} unidades disponíveis.`);
        }

        if (existingItemIndex > -1) {
            cart.items[existingItemIndex].quantity = newTotalQuantity;
        } else {
            cart.items.push({
                productId: productId,
                quantity: addToCartDto.quantity,
                unitPrice: Types.Decimal128.fromString(String(await this.pricing.getBasePrice(productId)))
            });
        }

        await cart.save();

        const cartObj = cart.toObject();
        await this.populateCartItemsWithProducts(cartObj);
        return cartObj;
    }

    async updateItemQuantity(customerId: string | null, sessionId: string | null, dto: { productId: string | number, quantity: number }): Promise<any> {
        const cart = await this.findOrCreateCart(customerId || undefined, sessionId || undefined);
        const productId = String(dto.productId);

        const product = await this.productService.findOne(productId);
        if (!product) {
            throw new NotFoundException('Product not found');
        }

        const existingItemIndex = cart.items.findIndex(i => String(i.productId) === productId);
        if (existingItemIndex === -1) {
            throw new NotFoundException('Item not found in cart');
        }

        // Validate Stock (real-time from stock_movements)
        const stock = (await this.stockQuery.getProductStock(productId)).available;
        if (dto.quantity > stock) {
            throw new BadRequestException(`Apenas ${stock} unidades disponíveis.`);
        }

        if (dto.quantity <= 0) {
            // Remove item
            cart.items.splice(existingItemIndex, 1);
        } else {
            cart.items[existingItemIndex].quantity = dto.quantity;
        }

        await cart.save();

        const cartObj = cart.toObject();
        await this.populateCartItemsWithProducts(cartObj);
        return cartObj;
    }

    private async populateCartItemsWithProducts(cart: any) {
        // Collect IDs
        const productIds = [...new Set(cart.items.map((i: any) => i.productId))];

        const products = [];
        for (const pid of productIds) {
            try {
                const p = await this.productService.findOne(pid as string);
                if (p) products.push(p);
            } catch (e) { }
        }

        for (const item of cart.items) {
            const p = products.find(p => String(p._id) === String(item.productId) || String(p.sku) === String(item.productId) || p.externalId === String(item.productId));
            item.product = p;
        }
    }

    async removeItem(customerId: string | null, sessionId: string | null, itemId: string): Promise<any> {
        const cart = await this.findOrCreateCart(customerId || undefined, sessionId || undefined);

        // Filter out the item
        cart.items = cart.items.filter((item: any) =>
            String(item._id) !== itemId && String(item.productId) !== itemId
        );

        await cart.save();

        const cartObj = cart.toObject();
        await this.populateCartItemsWithProducts(cartObj);
        return cartObj;
    }

    async getCart(customerId: string | null, sessionId: string | null): Promise<any> {
        const cart = await this.findOrCreateCart(customerId || undefined, sessionId || undefined);
        const cartObj = cart.toObject();
        await this.populateCartItemsWithProducts(cartObj);
        return cartObj;
    }

    async createTestCoupon() {
        const existing = await this.couponModel.findOne({ code: 'ROCKET10' });
        if (existing) return existing;

        const coupon = new this.couponModel({
            code: 'ROCKET10',
            type: 'PERCENTAGE',
            value: 10, // 10%
            isActive: true,
            minPurchase: 100
        });
        return coupon.save();
    }

    /**
     * Revalida o cupom já aplicado ao carrinho no momento do checkout — cupom pode ter sido
     * desativado/esgotado/vencido entre a aplicação e a confirmação do pedido. Checa também o
     * limite por cliente (não checado em applyCoupon, só aqui). Retorna null se não há cupom.
     */
    async revalidateCouponForCheckout(customerId: string | null, couponCode?: string): Promise<CouponDocument | null> {
        if (!couponCode) return null;

        const coupon = await this.couponModel.findOne({ code: couponCode.toUpperCase(), isActive: true });
        if (!coupon) throw new BadRequestException('Cupom inválido ou expirado.');
        if (coupon.expirationDate && new Date() > coupon.expirationDate) {
            throw new BadRequestException('Este cupom expirou.');
        }
        if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) {
            throw new BadRequestException('Este cupom atingiu o limite de uso.');
        }
        if (coupon.usageLimitPerCustomer && customerId) {
            const used = await this.couponRedemptionModel.countDocuments({ couponId: coupon._id, customerId });
            if (used >= coupon.usageLimitPerCustomer) {
                throw new BadRequestException('Você já utilizou este cupom o número máximo de vezes permitido.');
            }
        }
        return coupon;
    }

    /** Registra o uso confirmado (pedido criado) e incrementa o contador global — atômico. */
    async redeemCoupon(coupon: CouponDocument, customerId: string, orderId: string): Promise<void> {
        await this.couponRedemptionModel.create({ couponId: coupon._id, customerId, orderId });
        await this.couponModel.updateOne({ _id: coupon._id }, { $inc: { usedCount: 1 } });
    }
}

