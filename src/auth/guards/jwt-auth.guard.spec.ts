import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthService } from '../auth.service';

function makeContext(request: any): ExecutionContext {
  return {
    getType: () => 'http',
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let jwtService: { verify: jest.Mock };
  let authService: { findById: jest.Mock };
  let reflector: Reflector;

  beforeEach(() => {
    jwtService = { verify: jest.fn() };
    authService = { findById: jest.fn() };
    reflector = new Reflector();
    guard = new JwtAuthGuard(jwtService as unknown as JwtService, reflector, authService as unknown as AuthService);
  });

  it('popula req.user.storeId a partir do banco (payload assinado nunca carrega storeId)', async () => {
    jwtService.verify.mockReturnValue({ sub: 'U1', email: 'g@x.com', roles: ['user'] });
    authService.findById.mockResolvedValue({ storeId: 'store-maxeshop' });
    const request: any = { headers: { authorization: 'Bearer token123' } };

    const result = await guard.canActivate(makeContext(request));

    expect(result).toBe(true);
    expect(request.user.storeId).toBe('store-maxeshop');
  });

  it('req.user.storeId é null (não undefined) quando o usuário não tem loja associada', async () => {
    jwtService.verify.mockReturnValue({ sub: 'U1', email: 'g@x.com', roles: ['user'] });
    authService.findById.mockResolvedValue({ storeId: null });
    const request: any = { headers: { authorization: 'Bearer token123' } };

    await guard.canActivate(makeContext(request));

    expect(request.user.storeId).toBeNull();
  });

  it('rejeita sem token', async () => {
    const request: any = { headers: {} };
    await expect(guard.canActivate(makeContext(request))).rejects.toThrow(UnauthorizedException);
  });

  it('rejeita token inválido', async () => {
    jwtService.verify.mockImplementation(() => { throw new Error('invalid'); });
    const request: any = { headers: { authorization: 'Bearer bad' } };
    await expect(guard.canActivate(makeContext(request))).rejects.toThrow(UnauthorizedException);
  });
});
