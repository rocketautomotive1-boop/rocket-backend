import { Types } from 'mongoose';
import {
  mapMlStatusToInternal,
  planStatusSync,
  syncMlListingStatus,
  ListingForStatusSync,
  MlItemStatus,
} from '../../scripts/sync-ml-listing-status';

function oid() {
  return new Types.ObjectId();
}

function listing(overrides: Partial<ListingForStatusSync> = {}): ListingForStatusSync {
  return {
    _id: oid(),
    externalId: 'MLB1000000001',
    status: 'active',
    ...overrides,
  };
}

describe('mapMlStatusToInternal', () => {
  it('mapeia active/paused/inactive para o enum interno', () => {
    expect(mapMlStatusToInternal('active')).toBe('active');
    expect(mapMlStatusToInternal('paused')).toBe('paused');
    expect(mapMlStatusToInternal('inactive')).toBe('removed');
  });

  it('retorna null para status desconhecido (não força mapeamento arbitrário)', () => {
    expect(mapMlStatusToInternal('under_review')).toBeNull();
    expect(mapMlStatusToInternal('closed')).toBeNull();
  });
});

describe('planStatusSync', () => {
  it('pula listings em status operacionais do nosso próprio pipeline (pending_creation)', () => {
    const l = listing({ status: 'pending_creation' });
    const outcome = planStatusSync(l, { status: 'active', subStatus: [] });
    expect(outcome).toEqual({ kind: 'skipped_own_pipeline_status' });
  });

  it('pula listings em pending_removal/removal_failed/error mesmo com item resolvido no ML', () => {
    for (const status of ['pending_removal', 'removal_failed', 'error'] as const) {
      const l = listing({ status });
      const outcome = planStatusSync(l, { status: 'active', subStatus: [] });
      expect(outcome).toEqual({ kind: 'skipped_own_pipeline_status' });
    }
  });

  it('marca already_correct quando o status interno já bate com o ML', () => {
    const l = listing({ status: 'active' });
    const outcome = planStatusSync(l, { status: 'active', subStatus: [] });
    expect(outcome).toEqual({ kind: 'already_correct' });
  });

  it('detecta o caso real do 19347751: interno active, ML inactive/forbidden+deleted → corrected para removed', () => {
    const l = listing({ status: 'active' });
    const mlItem: MlItemStatus = { status: 'inactive', subStatus: ['forbidden', 'deleted'] };
    const outcome = planStatusSync(l, mlItem);
    expect(outcome).toEqual({ kind: 'corrected', from: 'active', to: 'removed' });
  });

  it('corrige active → paused quando o ML real está pausado', () => {
    const l = listing({ status: 'active' });
    const outcome = planStatusSync(l, { status: 'paused', subStatus: [] });
    expect(outcome).toEqual({ kind: 'corrected', from: 'active', to: 'paused' });
  });

  it('trata item ausente no multiget (excluído/expirado) como removed', () => {
    const l = listing({ status: 'active' });
    const outcome = planStatusSync(l, undefined);
    expect(outcome).toEqual({ kind: 'corrected', from: 'active', to: 'removed' });
  });

  it('item ausente no multiget e já removed localmente → already_correct, não regrava', () => {
    const l = listing({ status: 'removed' });
    const outcome = planStatusSync(l, undefined);
    expect(outcome).toEqual({ kind: 'already_correct' });
  });

  it('reporta unmapped_ml_status para valores fora do enum conhecido, sem gravar nada', () => {
    const l = listing({ status: 'active' });
    const outcome = planStatusSync(l, { status: 'under_review', subStatus: [] });
    expect(outcome).toEqual({ kind: 'unmapped_ml_status', mlStatus: 'under_review' });
  });
});

describe('syncMlListingStatus', () => {
  it('não chama updateStatus em modo dry-run mesmo quando há correção', async () => {
    const l = listing({ status: 'active' });
    const updateStatus = jest.fn();
    const summary = await syncMlListingStatus({
      listings: [l],
      mlItemByExternalId: new Map([[l.externalId, { status: 'inactive', subStatus: [] }]]),
      updateStatus,
      dryRun: true,
    });
    expect(updateStatus).not.toHaveBeenCalled();
    expect(summary.corrected).toBe(1);
  });

  it('chama updateStatus com o novo status quando dryRun=false', async () => {
    const l = listing({ status: 'active' });
    const updateStatus = jest.fn().mockResolvedValue(undefined);
    await syncMlListingStatus({
      listings: [l],
      mlItemByExternalId: new Map([[l.externalId, { status: 'paused', subStatus: [] }]]),
      updateStatus,
      dryRun: false,
    });
    expect(updateStatus).toHaveBeenCalledWith(l._id, 'paused');
  });

  it('agrega o resumo corretamente para um lote misto', async () => {
    const active = listing({ status: 'active' });
    const alreadyPaused = listing({ status: 'paused', externalId: 'MLB2' });
    const pendingCreation = listing({ status: 'pending_creation', externalId: 'MLB3' });
    const unmapped = listing({ status: 'active', externalId: 'MLB4' });

    const summary = await syncMlListingStatus({
      listings: [active, alreadyPaused, pendingCreation, unmapped],
      mlItemByExternalId: new Map([
        [active.externalId, { status: 'inactive', subStatus: ['forbidden', 'deleted'] }],
        [alreadyPaused.externalId, { status: 'paused', subStatus: [] }],
        [unmapped.externalId, { status: 'under_review', subStatus: [] }],
      ]),
      updateStatus: jest.fn().mockResolvedValue(undefined),
      dryRun: false,
    });

    expect(summary).toEqual({
      total: 4,
      skippedOwnPipelineStatus: 1,
      alreadyCorrect: 1,
      corrected: 1,
      notFoundInMl: 0,
      unmappedMlStatus: 1,
    });
  });
});
