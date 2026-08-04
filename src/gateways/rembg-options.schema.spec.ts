import { ZodError } from 'zod';
import { rembgOptionsSchema, DEFAULT_REMBG_OPTIONS } from './rembg-options.schema';

describe('rembgOptionsSchema', () => {
  it('applies per-field defaults when no options are sent (backward compat with hardcoded values)', () => {
    expect(rembgOptionsSchema.parse({})).toEqual(DEFAULT_REMBG_OPTIONS);
  });

  it('accepts a full valid payload from the frontend rembg options store', () => {
    const input = {
      provider: 'rembg',
      model: 'u2net',
      crop: false,
      shadow: true,
      padding: 25,
      target_size: 1500,
      alpha_matting: false,
      clahe: true,
      background_color: '#ffffff',
    };
    expect(rembgOptionsSchema.parse(input)).toEqual(input);
  });

  it('rejects an unknown field (.strict())', () => {
    expect(() => rembgOptionsSchema.parse({ notAField: true })).toThrow(ZodError);
  });

  it('rejects an out-of-range padding', () => {
    expect(() => rembgOptionsSchema.parse({ padding: 999 })).toThrow(ZodError);
  });

  it('rejects an out-of-range target_size', () => {
    expect(() => rembgOptionsSchema.parse({ target_size: 100 })).toThrow(ZodError);
  });

  it('rejects an invalid provider', () => {
    expect(() => rembgOptionsSchema.parse({ provider: 'invalid' })).toThrow(ZodError);
  });
});
