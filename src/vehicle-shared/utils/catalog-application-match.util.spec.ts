import {
  parsePeriodoToYearRange,
  extractDisplacementsCc,
  classifyCandidatesByEngine,
} from './catalog-application-match.util';
import { VEHICLE_CONSTANTS } from '../constants/vehicle.constants';

describe('parsePeriodoToYearRange', () => {
  it('parses a closed range', () => {
    expect(parsePeriodoToYearRange('2000/2019')).toEqual({ from: 2000, to: 2019 });
  });

  it('parses an open-ended range as running to the max production year', () => {
    expect(parsePeriodoToYearRange('2018/')).toEqual({ from: 2018, to: VEHICLE_CONSTANTS.MAX_PRODUCTION_YEAR });
  });

  it('returns undefined for empty/missing periodo', () => {
    expect(parsePeriodoToYearRange(undefined)).toBeUndefined();
    expect(parsePeriodoToYearRange('')).toBeUndefined();
  });

  it('returns undefined for unparseable periodo', () => {
    expect(parsePeriodoToYearRange('sempre')).toBeUndefined();
  });

  it('returns undefined when the range is inverted', () => {
    expect(parsePeriodoToYearRange('2019/2000')).toBeUndefined();
  });
});

describe('extractDisplacementsCc', () => {
  it('extracts a single displacement in liters format', () => {
    expect(extractDisplacementsCc('2.8 TURBO DIESEL')).toEqual([2800]);
  });

  it('extracts a single displacement in cc format', () => {
    expect(extractDisplacementsCc('2300 cc diesel')).toEqual([2300]);
  });

  it('extracts multiple displacements from a slash-separated line', () => {
    expect(extractDisplacementsCc('1.0/1.3/1.5 FIRE-FIASA')).toEqual([1000, 1300, 1500]);
  });

  it('returns an empty array when there is no recognizable displacement', () => {
    expect(extractDisplacementsCc('TURBO DIESEL')).toEqual([]);
    expect(extractDisplacementsCc(undefined)).toEqual([]);
  });
});

describe('classifyCandidatesByEngine', () => {
  it('matches a candidate whose displacement and fuel line up', () => {
    const result = classifyCandidatesByEngine('2.8 TURBO DIESEL', [
      { vehicleId: 'v1', displacementCc: 2800, fuelType: 'Diesel' },
    ]);
    expect(result.matched).toEqual(['v1']);
    expect(result.needsReview).toEqual([]);
    expect(result.rejected).toEqual([]);
  });

  it('rejects a candidate whose displacement explicitly differs', () => {
    const result = classifyCandidatesByEngine('2.8 TURBO DIESEL', [
      { vehicleId: 'v1', displacementCc: 2300, fuelType: 'Diesel' },
    ]);
    expect(result.matched).toEqual([]);
    expect(result.needsReview).toEqual([]);
    expect(result.rejected).toEqual(['v1']);
  });

  it('rejects a candidate whose fuel type has no overlap', () => {
    const result = classifyCandidatesByEngine('1.0 FLEX', [
      { vehicleId: 'v1', displacementCc: 1000, fuelType: 'Diesel' },
    ]);
    expect(result.matched).toEqual([]);
    expect(result.needsReview).toEqual([]);
    expect(result.rejected).toEqual(['v1']);
  });

  it('matches when the line has no engine info to compare (nothing to contradict)', () => {
    const result = classifyCandidatesByEngine(undefined, [{ vehicleId: 'v1', displacementCc: 2800, fuelType: 'Diesel' }]);
    expect(result.matched).toEqual(['v1']);
  });

  it('needs review when the candidate has no engine info to compare against a line that does', () => {
    const result = classifyCandidatesByEngine('2.8 TURBO DIESEL', [{ vehicleId: 'v1' }]);
    expect(result.matched).toEqual([]);
    expect(result.needsReview).toEqual(['v1']);
    expect(result.rejected).toEqual([]);
  });

  it('needs review when displacement matches but fuel type is missing on the candidate', () => {
    const result = classifyCandidatesByEngine('2.8 TURBO DIESEL', [{ vehicleId: 'v1', displacementCc: 2800 }]);
    expect(result.matched).toEqual([]);
    expect(result.needsReview).toEqual(['v1']);
    expect(result.rejected).toEqual([]);
  });

  it('needs review when fuel type matches but displacement is missing on the candidate', () => {
    const result = classifyCandidatesByEngine('2.8 TURBO DIESEL', [{ vehicleId: 'v1', fuelType: 'Diesel' }]);
    expect(result.matched).toEqual([]);
    expect(result.needsReview).toEqual(['v1']);
    expect(result.rejected).toEqual([]);
  });

  it('accepts a candidate matching any one of several displacements on the line', () => {
    // "FIRE-FIASA" is an engine family name, not a recognizable fuel word — the line simply
    // doesn't specify a fuel type, so there's nothing to confirm or contradict on that axis.
    const result = classifyCandidatesByEngine('1.0/1.3/1.5 FIRE-FIASA', [
      { vehicleId: 'v1', displacementCc: 1300, fuelType: 'Gasolina' },
    ]);
    expect(result.matched).toEqual(['v1']);
  });

  it('rejects a candidate matching none of several displacements on the line', () => {
    const result = classifyCandidatesByEngine('1.0/1.3/1.5 FIRE-FIASA', [
      { vehicleId: 'v1', displacementCc: 1800, fuelType: 'Gasolina' },
    ]);
    expect(result.matched).toEqual([]);
    expect(result.rejected).toEqual(['v1']);
  });
});
