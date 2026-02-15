import { Controller, Post, Body, Get, Param, Sse } from '@nestjs/common';
import { Observable } from 'rxjs';
import { MessageEvent } from '@nestjs/common';
import { AiBatchService } from './ai-batch.service';

type BatchItemInput = { url?: string; base64?: string; mimeType?: string; filename?: string; text?: string };

@Controller('ai')
export class AiBatchController {
  constructor(private readonly service: AiBatchService) { }

  @Post('batch')
  async createBatch(@Body() body: { items: BatchItemInput[] }) {
    const batchId = await this.service.createBatch(body.items || []);
    return { batchId };
  }

  @Post('text-batch')
  async createTextBatch(@Body() body: { items: BatchItemInput[] }) {
    const batchId = await this.service.createTextBatch((body.items || []).map(i => ({ text: i.text || '', base64: i.base64, mimeType: i.mimeType })));
    return { batchId };
  }

  @Post('ocr')
  async extractText(@Body() body: { base64: string; mimeType?: string }) {
    const text = await this.service.ocrFromImage(body.base64, body.mimeType || 'image/jpeg');
    return { text };
  }

  @Get('batch/:batchId/status')
  async getStatus(@Param('batchId') batchId: string) {
    return await this.service.getBatchStatus(batchId);
  }

  @Post('batch/:batchId/cancel')
  async cancel(@Param('batchId') batchId: string) {
    await this.service.cancelBatch(batchId);
    return { ok: true };
  }

  @Post('estimate-price')
  async estimatePrice(@Body() body: { partNumber: string; brand: string }) {
    if (!body.partNumber || !body.brand) {
      throw new Error('partNumber and brand are required');
    }
    return this.service.estimatePrice(body.partNumber, body.brand);
  }

  @Post('draft/:id/process')
  async processDraft(@Param('id') id: string) {
    return await this.service.processDraft(id);
  }

  @Sse('batch/:batchId/subscribe')
  subscribe(@Param('batchId') batchId: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      let stopped = false;
      const interval = setInterval(async () => {
        if (stopped) return;
        try {
          const status = await this.service.getBatchStatus(batchId);
          if (status.state === 'complete') {
            subscriber.next({ data: { type: 'batch_complete', batchId, status } });
            subscriber.complete();
            clearInterval(interval);
          } else {
            subscriber.next({ data: { type: 'batch_progress', batchId, status } });
          }
        } catch (e) {
          subscriber.error(e);
          clearInterval(interval);
        }
      }, 2000);
      return () => {
        stopped = true;
        clearInterval(interval);
      };
    });
  }
}