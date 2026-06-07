import { NotificationReadService } from './notification-read.service';

function makeModel() {
  const chain = (result: any) => ({
    sort: () => chain2(result),
  });
  const chain2 = (result: any) => ({
    skip: () => ({ limit: () => ({ lean: () => ({ exec: () => Promise.resolve(result) }) }) }),
  });
  return {
    find: jest.fn().mockReturnValue(chain([{ _id: '1', readBy: ['u1'] }])),
    countDocuments: jest.fn().mockReturnValue({ exec: () => Promise.resolve(1) }),
    updateOne: jest.fn().mockResolvedValue({}),
    updateMany: jest.fn().mockResolvedValue({}),
  } as any;
}

describe('NotificationReadService', () => {
  it('findAll marca read=true quando o userId está em readBy', async () => {
    const svc = new NotificationReadService(makeModel());
    const { items, total } = await svc.findAll({ userId: 'u1' });
    expect(total).toBe(1);
    expect((items[0] as any).read).toBe(true);
  });

  it('getUnreadCount conta docs não lidos pelo usuário', async () => {
    const model = makeModel();
    await new NotificationReadService(model).getUnreadCount('u1');
    expect(model.countDocuments).toHaveBeenCalledWith({ readBy: { $ne: 'u1' } });
  });

  it('markAsRead faz $addToSet em readBy', async () => {
    const model = makeModel();
    await new NotificationReadService(model).markAsRead('n1', 'u1');
    expect(model.updateOne).toHaveBeenCalledWith({ _id: 'n1' }, { $addToSet: { readBy: 'u1' } });
  });
});
