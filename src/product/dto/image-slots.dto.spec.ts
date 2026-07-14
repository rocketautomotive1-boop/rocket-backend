import { imageSlotsSchema } from './image-slots.dto';

const kept = (slotId: string, position: number) => ({ slotId, position, kind: 'kept', key: `k-${slotId}` });
const upload = (slotId: string, position: number, fileIndex: number) => ({ slotId, position, kind: 'upload', fileIndex });
const pending = (slotId: string, position: number, fileIndex: number) => ({ slotId, position, kind: 'pending', fileIndex });

describe('imageSlotsSchema — ordered contract guards', () => {
  it('accepts a valid interleaved ordered list', () => {
    const slots = [kept('a', 0), upload('b', 1, 0), pending('c', 2, 1), kept('d', 3)];
    const parsed = imageSlotsSchema.parse(slots);
    expect(parsed.map(s => s.position)).toEqual([0, 1, 2, 3]);
  });

  it('rejects duplicate positions (ambiguous order)', () => {
    expect(() => imageSlotsSchema.parse([kept('a', 0), kept('b', 0)])).toThrow(/positions duplicadas/);
  });

  it('rejects duplicate slotIds (ambiguous identity)', () => {
    expect(() => imageSlotsSchema.parse([kept('a', 0), upload('a', 1, 0)])).toThrow(/slotIds duplicados/);
  });

  it('rejects a kept slot without key or url', () => {
    expect(() => imageSlotsSchema.parse([{ slotId: 'a', position: 0, kind: 'kept' }])).toThrow(/key ou url/);
  });

  it('rejects an upload/pending slot without fileIndex', () => {
    expect(() => imageSlotsSchema.parse([{ slotId: 'a', position: 0, kind: 'upload' }])).toThrow(/fileIndex/);
  });

  it('rejects an unknown kind', () => {
    expect(() => imageSlotsSchema.parse([{ slotId: 'a', position: 0, kind: 'whatever' }])).toThrow();
  });
});
