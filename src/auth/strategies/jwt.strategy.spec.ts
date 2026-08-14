import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';
import { AuthService } from '../auth.service';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let authService: { findById: jest.Mock };

  beforeEach(async () => {
    authService = { findById: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        { provide: AuthService, useValue: authService },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('secret') } },
      ],
    }).compile();

    strategy = module.get(JwtStrategy);
  });

  it('inclui storeId do usuário resolvido no payload retornado', async () => {
    authService.findById.mockResolvedValue({ storeId: 'store-maxeshop' });

    const result = await strategy.validate({ sub: 'U1', email: 'g@x.com', roles: ['user'] });

    expect(result.storeId).toBe('store-maxeshop');
  });

  it('retorna storeId null (não undefined) quando o usuário não tem loja associada', async () => {
    authService.findById.mockResolvedValue({ storeId: null });

    const result = await strategy.validate({ sub: 'U1', email: 'g@x.com', roles: ['user'] });

    expect(result.storeId).toBeNull();
  });

  it('retorna storeId null quando o campo está ausente do documento do usuário', async () => {
    authService.findById.mockResolvedValue({});

    const result = await strategy.validate({ sub: 'U1', email: 'g@x.com', roles: ['user'] });

    expect(result.storeId).toBeNull();
  });
});
