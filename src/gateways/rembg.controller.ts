import { Controller, Get, Query } from '@nestjs/common';
import { ProcessedImageService } from '../processed-image/processed-image.service';

/**
 * Read-only repository of processed images. Background removal itself is no longer driven
 * from here — it runs through the durable job pipeline (RembgEnqueueService →
 * RembgDispatchWorker → microservice → /internal/rembg/result). The old synchronous
 * `POST /rembg/process` WS-RPC endpoint was removed: it spent credits and persisted the
 * result only AFTER a fragile WS reply, so a lost reply lost the paid image.
 */
@Controller('rembg')
export class RembgController {
  constructor(private readonly processedImageService: ProcessedImageService) {}

  @Get('repository')
  async listRepository(
    @Query('batchCode') batchCode?: string,
    @Query('search') search?: string,
    @Query('page') pageParam?: string,
    @Query('limit') limitParam?: string,
  ): Promise<any> {
    const page = Number(pageParam || '1');
    const limit = Number(limitParam || '30');

    return this.processedImageService.listProcessedImages({
      batchCode,
      search,
      page: Number.isFinite(page) ? page : 1,
      limit: Number.isFinite(limit) ? limit : 30,
    });
  }
}
