import { Controller, Get, Query, Post, Body } from '@nestjs/common';
import { MagaluAuthAdapter } from '../adapters/magalu/magalu-auth.adapter';
import { MagaluProductAdapter } from '../adapters/magalu/magalu-product.adapter';

const pkceStore = new Map<string, string>(); // state -> code_verifier

function ensureState(state?: string) {
  // gere um state se não vier do cliente
  return state && state.trim().length > 0 ? state : Math.random().toString(36).slice(2);
}

@Controller('marketplace/magalu')
export class MagaluController {
  constructor(
    private readonly auth: MagaluAuthAdapter,
    private readonly products: MagaluProductAdapter,
  ) {}

  @Get('auth/url')
  getAuthUrl(@Query('state') providedState?: string) {
    const state = ensureState(providedState);
    const { url, codeVerifier } = this.auth.getAuthorizeUrl(state);
    pkceStore.set(state, codeVerifier);
    return { url, state }; // devolve o state para o client
  }

  @Get('auth/callback')
  async callback(@Query('code') code: string, @Query('state') state?: string) {
    const verifier = state ? pkceStore.get(state) : undefined;
    const tokens = await this.auth.exchangeCode(code, verifier);
    if (state) pkceStore.delete(state);
    return tokens;
  }

  @Get('categories')
  async categories(@Query('accessToken') token: string) {
    return this.products.getCategories(token);
  }

  @Get('categories/attributes')
  async attributes(@Query('accessToken') token: string, @Query('categoryId') categoryId: string) {
    return this.products.getCategoryAttributes(token, categoryId);
  }

  @Post('products/upsert')
  async upsert(@Body() body: { accessToken: string; payload: any }) {
    return this.products.upsertProduct(body.accessToken, body.payload);
  }

  @Post('listings/publish')
  async publish(@Body() body: { accessToken: string; productExternalId: string }) {
    return this.products.publishListing(body.accessToken, body.productExternalId);
  }
}