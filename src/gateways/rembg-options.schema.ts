import { z } from 'zod';

/**
 * Source of truth for the rembg processing options on the backend.
 * Mirrors the frontend type in frontend/src/types/rembgOptions.ts and the
 * metadata schema documented in microservices/rembg/main.py.
 *
 * All fields are optional on input — defaults are applied per-field so a
 * client that omits e.g. `clahe` still gets a coherent payload downstream.
 */
export const rembgOptionsSchema = z
  .object({
    provider: z.enum(['photoroom', 'rembg']).default('photoroom'),
    model: z.string().min(1).max(64).default('isnet-general-use'),
    crop: z.boolean().default(true),
    shadow: z.boolean().default(false),
    padding: z.number().int().min(0).max(100).default(10),
    target_size: z.number().int().min(500).max(2000).default(1000),
    alpha_matting: z.boolean().default(true),
    clahe: z.boolean().default(false),
    background_color: z.string().max(16).default(''),
  })
  .strict();

export type RembgOptions = z.infer<typeof rembgOptionsSchema>;

/** Resolved defaults — useful when no options are sent at all. */
export const DEFAULT_REMBG_OPTIONS: RembgOptions = rembgOptionsSchema.parse({});
