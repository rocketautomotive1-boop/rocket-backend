import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { UserAdminController } from './user-admin.controller';
import { UserModel } from '../schemas/user.schema';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';

describe('UserAdminController', () => {
  let controller: UserAdminController;
  let modelMock: any;

  beforeEach(async () => {
    modelMock = {
      find: jest.fn(),
      updateOne: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [UserAdminController],
      providers: [{ provide: getModelToken(UserModel.name), useValue: modelMock }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(UserAdminController);
  });

  it('list: projeta só os campos necessários e normaliza _id/groupId', async () => {
    modelMock.find.mockReturnValue({
      lean: () => ({
        exec: async () => [
          { _id: 'U1', name: 'Djalma Junior', email: 'd@x.com', roles: ['user'], groupId: 'G1' },
          { _id: 'U2', name: 'Gustavo', email: 'g@x.com', roles: ['admin'] },
        ],
      }),
    });

    const result = await controller.list();

    expect(result).toEqual([
      { id: 'U1', name: 'Djalma Junior', email: 'd@x.com', roles: ['user'], groupId: 'G1' },
      { id: 'U2', name: 'Gustavo', email: 'g@x.com', roles: ['admin'], groupId: null },
    ]);
  });

  it('setGroup: grava groupId e retorna updated:true', async () => {
    modelMock.updateOne.mockReturnValue({ exec: async () => ({ matchedCount: 1 }) });

    const result = await controller.setGroup('U1', { groupId: 'G1' });

    expect(modelMock.updateOne).toHaveBeenCalledWith({ _id: 'U1' }, { $set: { groupId: 'G1' } });
    expect(result).toEqual({ updated: true });
  });

  it('setGroup: aceita groupId null para desatribuir', async () => {
    modelMock.updateOne.mockReturnValue({ exec: async () => ({ matchedCount: 1 }) });

    await controller.setGroup('U1', { groupId: null });

    expect(modelMock.updateOne).toHaveBeenCalledWith({ _id: 'U1' }, { $set: { groupId: null } });
  });

  it('setGroup: usuário inexistente lança BadRequestException', async () => {
    modelMock.updateOne.mockReturnValue({ exec: async () => ({ matchedCount: 0 }) });

    await expect(controller.setGroup('U_MISSING', { groupId: 'G1' })).rejects.toThrow(
      'Usuário U_MISSING não encontrado.',
    );
  });
});
