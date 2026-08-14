import { AudienceResolver } from './audience-resolver.service';

function makeUserModel(users: any[]) {
  return {
    find: jest.fn().mockReturnValue({ lean: () => ({ exec: () => Promise.resolve(users) }) }),
    findById: jest.fn().mockReturnValue({ lean: () => ({ exec: () => Promise.resolve(users[0] ?? null) }) }),
  } as any;
}

const u = (id: string, roles: string[], tokens: string[], email?: string) =>
  ({ _id: id, roles, pushTokens: tokens, email });

describe('AudienceResolver', () => {
  it('kind=user retorna o usuário específico', async () => {
    const model = makeUserModel([u('u1', ['admin'], ['t1'], 'a@x.com')]);
    const r = await new AudienceResolver(model).resolve({ kind: 'user', userId: 'u1' });
    expect(r).toEqual([{ userId: 'u1', pushTokens: ['t1'], email: 'a@x.com' }]);
  });

  it('kind=all-admins retorna users com role admin', async () => {
    const model = makeUserModel([u('u1', ['admin'], ['t1']), u('u2', ['admin'], ['t2'])]);
    const r = await new AudienceResolver(model).resolve({ kind: 'all-admins' });
    expect(r.map(x => x.userId)).toEqual(['u1', 'u2']);
    expect(model.find).toHaveBeenCalledWith({ roles: 'admin', isActive: { $ne: false } });
  });

  it('kind=role consulta pela role pedida', async () => {
    const model = makeUserModel([u('u1', ['operator'], ['t1'])]);
    await new AudienceResolver(model).resolve({ kind: 'role', role: 'operator' });
    expect(model.find).toHaveBeenCalledWith({ roles: 'operator', isActive: { $ne: false } });
  });

  it('kind=broadcast retorna todos os usuários ativos', async () => {
    const model = makeUserModel([u('u1', [], ['t1'])]);
    await new AudienceResolver(model).resolve({ kind: 'broadcast' });
    expect(model.find).toHaveBeenCalledWith({ isActive: { $ne: false } });
  });

  it('fail-open: erro ao resolver cai para all-admins', async () => {
    const model: any = {
      findById: jest.fn().mockReturnValue({ lean: () => ({ exec: () => Promise.reject(new Error('db down')) }) }),
      find: jest.fn().mockReturnValue({ lean: () => ({ exec: () => Promise.resolve([u('a', ['admin'], ['t'])]) }) }),
    };
    const r = await new AudienceResolver(model).resolve({ kind: 'user', userId: 'u1' });
    expect(r.map(x => x.userId)).toEqual(['a']);
    expect(model.find).toHaveBeenCalledWith({ roles: 'admin', isActive: { $ne: false } });
  });
});
