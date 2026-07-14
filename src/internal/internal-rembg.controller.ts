import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { InternalKeyGuard } from './internal-key.guard';
import { RembgCompletionService } from '../gateways/rembg-completion.service';

interface RembgResultDto {
  jobId: string;
  status: 'success' | 'error';
  url?: string;
  key?: string;
  source?: string | null;
  message?: string;
  /** When true, the source image is permanently unusable → fail terminally, never retry. */
  permanent?: boolean;
}

/**
 * Result callback from the rembg microservice. Idempotent by jobId — a duplicated or
 * late callback is a safe no-op. This is the durable handoff that replaces the old
 * fragile "await one WebSocket frame" RPC: the microservice has already persisted the
 * processed PNG to S3 before calling here, so the paid result can never be lost.
 */
@UseGuards(InternalKeyGuard)
@SkipThrottle()
@Controller('internal/rembg')
export class InternalRembgController {
  constructor(private readonly completion: RembgCompletionService) {}

  @Post('result')
  @HttpCode(200)
  async result(@Body() body: RembgResultDto): Promise<{ ok: true }> {
    if (!body?.jobId) return { ok: true };

    if (body.status === 'success' && body.url && body.key) {
      await this.completion.applySuccess(body.jobId, {
        url: body.url,
        key: body.key,
        source: body.source ?? null,
      });
    } else {
      await this.completion.applyFailure(body.jobId, body.message || 'rembg reported error', !!body.permanent);
    }
    return { ok: true };
  }
}
