import { Controller, Get, Post, Body, Delete, Param, UseGuards, Request, Query } from '@nestjs/common';
import { CartService } from './cart.service';
import { CheckoutService } from './checkout.service';
import { AddToCartDto } from './dto/add-to-cart.dto';

// We need a strategy to identify guest users (Session ID) vs Logged users.
// For now, we accept a 'session_id' query param for guests, or Bearer token for logged users.

@Controller('cart')
export class CartController {
    constructor(
        private readonly cartService: CartService,
        private readonly checkoutService: CheckoutService
    ) { }

    @Get()
    async getCart(@Request() req, @Query('session_id') sessionId: string) {
        // TODO: Implement proper CustomerAuthGuard that populates req.user
        const customerId = req.user?.id ? req.user.id : null;

        return this.cartService.getCart(customerId, sessionId);
    }

    @Post('items')
    async addItem(@Request() req, @Query('session_id') sessionId: string, @Body() dto: AddToCartDto) {
        const customerId = req.user?.id ? req.user.id : null;
        return this.cartService.addToCart(customerId, sessionId, dto);
    }

    @Delete('items/:id')
    async removeItem(@Request() req, @Query('session_id') sessionId: string, @Param('id') itemId: string) {
        const customerId = req.user?.id ? req.user.id : null;
        return this.cartService.removeItem(customerId, sessionId, itemId);
    }

    @Post('items/update') // Using Post for compatibility, but conceptually Patch. Or Patch.
    async updateItem(@Request() req, @Query('session_id') sessionId: string, @Body() dto: AddToCartDto) {
        const customerId = req.user?.id ? req.user.id : null;
        return this.cartService.updateItemQuantity(customerId, sessionId, dto);
    }

    @Post('coupon')
    async applyCoupon(@Request() req, @Query('session_id') sessionId: string, @Body() body: { code: string }) {
        const customerId = req.user?.id ? req.user.id : null;
        return this.cartService.applyCoupon(customerId, sessionId, body.code);
    }

    @Post('freight')
    async calculateFreight(@Request() req, @Body() body: { zipCode: string }) {
        const customerId = req.user?.id ? req.user.id : 1; // Default to 1 for testing if no auth
        // if (!customerId) throw new Error('Customer required for freight calc (mock)');
        return this.checkoutService.calculateFreight(customerId, body.zipCode);
    }

    @Post('checkout')
    async checkout(@Request() req, @Body() body: any) {
        const customerId = req.user?.id ? req.user.id : 1; // Default to 1 for testing if no auth
        return this.checkoutService.processCheckout(customerId, body);
    }
    @Get('seed-coupon')
    async seedCoupon() {
        return this.cartService.createTestCoupon();
    }
}
