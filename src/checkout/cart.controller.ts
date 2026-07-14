import { Controller, Get, Post, Body, Delete, Param, UseGuards, Request, Query, UnauthorizedException } from '@nestjs/common';
import { CartService } from './cart.service';
import { CheckoutService } from './checkout.service';
import { AddToCartDto } from './dto/add-to-cart.dto';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';

// Carrinho serve tanto convidado (session_id) quanto cliente logado (Bearer token).
// OptionalJwtAuthGuard popula req.user quando há token válido, sem nunca bloquear.
@UseGuards(OptionalJwtAuthGuard)
@Controller('cart')
export class CartController {
    constructor(
        private readonly cartService: CartService,
        private readonly checkoutService: CheckoutService
    ) { }

    @Get()
    async getCart(@Request() req, @Query('session_id') sessionId: string) {
        const customerId = req.user?.sub ?? null;
        return this.cartService.getCart(customerId, sessionId);
    }

    @Post('items')
    async addItem(@Request() req, @Query('session_id') sessionId: string, @Body() dto: AddToCartDto) {
        const customerId = req.user?.sub ?? null;
        return this.cartService.addToCart(customerId, sessionId, dto);
    }

    @Delete('items/:id')
    async removeItem(@Request() req, @Query('session_id') sessionId: string, @Param('id') itemId: string) {
        const customerId = req.user?.sub ?? null;
        return this.cartService.removeItem(customerId, sessionId, itemId);
    }

    @Post('items/update') // Using Post for compatibility, but conceptually Patch. Or Patch.
    async updateItem(@Request() req, @Query('session_id') sessionId: string, @Body() dto: AddToCartDto) {
        const customerId = req.user?.sub ?? null;
        return this.cartService.updateItemQuantity(customerId, sessionId, dto);
    }

    @Post('coupon')
    async applyCoupon(@Request() req, @Query('session_id') sessionId: string, @Body() body: { code: string }) {
        const customerId = req.user?.sub ?? null;
        return this.cartService.applyCoupon(customerId, sessionId, body.code);
    }

    @Post('freight')
    async calculateFreight(@Request() req, @Query('session_id') sessionId: string, @Body() body: { zipCode: string }) {
        const customerId = req.user?.sub ?? null;
        return this.checkoutService.calculateFreight(customerId, sessionId, body.zipCode);
    }

    /**
     * Checkout exige cliente autenticado — precisamos de um CustomerModel real
     * (email, documento, endereço) para gerar o Order e processar o pagamento no MP.
     */
    @Post('checkout')
    async checkout(@Request() req, @Body() body: any) {
        if (!req.user?.sub) {
            throw new UnauthorizedException('É necessário estar logado para finalizar a compra.');
        }
        return this.checkoutService.processCheckout(req.user.sub, body);
    }

    @Get('seed-coupon')
    async seedCoupon() {
        return this.cartService.createTestCoupon();
    }
}
