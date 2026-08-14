import { z } from 'zod';

/**
 * Ordered image slot contract (POST /products/:id/images).
 *
 * The frontend list is the single source of truth: it sends ONE ordered array of
 * slots, each carrying its `position` (defines `order`/`main`) and a stable `slotId`
 * (identity used to reconcile async rembg results back into the exact slot).
 *
 * - kind 'kept'    → image already stored on the product (resolved by `key`).
 * - kind 'upload'  → a new binary in `files`, matched by `fileIndex`.
 * - kind 'pending' → a new binary in `files` that must go through rembg; the backend
 *                    reserves a placeholder slot (status 'processing') and enqueues a job.
 */
export const imageSlotSchema = z
  .object({
    slotId: z.string().min(1, 'slotId é obrigatório'),
    position: z.number().int().min(0),
    kind: z.enum(['kept', 'upload', 'pending']),
    key: z.string().optional(),
    url: z.string().optional(),
    fileIndex: z.number().int().min(0).optional(),
    mimeType: z.string().optional(),
    fileName: z.string().optional(),
  })
  .superRefine((slot, ctx) => {
    if (slot.kind === 'kept' && !slot.key && !slot.url) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'slot kept exige key ou url' });
    }
    if ((slot.kind === 'upload' || slot.kind === 'pending') && slot.fileIndex === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'slot upload/pending exige fileIndex' });
    }
  });

export const imageSlotsSchema = z
  .array(imageSlotSchema)
  .superRefine((slots, ctx) => {
    const positions = slots.map((s) => s.position);
    if (new Set(positions).size !== positions.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'positions duplicadas' });
    }
    const slotIds = slots.map((s) => s.slotId);
    if (new Set(slotIds).size !== slotIds.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'slotIds duplicados' });
    }
  });

export type ImageSlot = z.infer<typeof imageSlotSchema>;
