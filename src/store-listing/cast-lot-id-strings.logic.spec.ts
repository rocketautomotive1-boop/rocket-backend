import { Types } from 'mongoose';
import { planLotIdStringCast } from '../../scripts/cast-lot-id-strings';

describe('planLotIdStringCast', () => {
  it('devolve plano vazio quando lotId já é ObjectId em todos os documentos', () => {
    const oid = new Types.ObjectId();
    const plan = planLotIdStringCast([{ _id: new Types.ObjectId(), lotId: oid }]);
    expect(plan).toHaveLength(0);
  });

  it('identifica documentos com lotId gravado como string e devolve o par (docId, castObjectId)', () => {
    const docId = new Types.ObjectId();
    const lotIdAsString = '6a26a2c3dc3565615371e5af';
    const plan = planLotIdStringCast([{ _id: docId, lotId: lotIdAsString as any }]);

    expect(plan).toHaveLength(1);
    expect(plan[0].docId.equals(docId)).toBe(true);
    expect(plan[0].castLotId).toBeInstanceOf(Types.ObjectId);
    expect(plan[0].castLotId.toString()).toBe(lotIdAsString);
  });

  it('ignora lotId ausente (movements sem lote associado)', () => {
    const plan = planLotIdStringCast([{ _id: new Types.ObjectId(), lotId: undefined }]);
    expect(plan).toHaveLength(0);
  });

  it('processa uma mistura de documentos corretos e incorretos, só reportando os incorretos', () => {
    const okId = new Types.ObjectId();
    const badId = new Types.ObjectId();
    const badLotId = '6a26a2c3dc3565615371e5af';

    const plan = planLotIdStringCast([
      { _id: okId, lotId: new Types.ObjectId() },
      { _id: badId, lotId: badLotId as any },
    ]);

    expect(plan).toHaveLength(1);
    expect(plan[0].docId.equals(badId)).toBe(true);
  });
});
