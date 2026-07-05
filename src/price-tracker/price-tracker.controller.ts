import {
  BadRequestException, Body, Controller, Delete, Get, HttpException, HttpStatus,
  NotFoundException, Param, Patch, Post, Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ZodError } from 'zod';
import { TrackedItemModel } from './schemas/tracked-item.schema';
import { PriceTrackerScanWorker } from './workers/price-tracker-scan.worker';
import { PriceTrackerQueryService } from './price-tracker-query.service';
import { createTrackedItemSchema, updateTrackedItemSchema } from './dto/tracked-item.dto';

const MANUAL_SCAN_COOLDOWN_MS = 5 * 60_000;

const zodMessage = (e: ZodError) => e.issues.map((i) => i.message).join('; ');

@ApiTags('price-tracker')
@Controller('price-tracker')
export class PriceTrackerController {
  /** Throttle em memória do scan manual: itemId → timestamp do último scan. */
  private readonly lastManualScan = new Map<string, number>();

  constructor(
    @InjectModel(TrackedItemModel.name) private readonly itemModel: Model<TrackedItemModel>,
    private readonly worker: PriceTrackerScanWorker,
    private readonly query: PriceTrackerQueryService,
  ) {}

  @Post('items')
  @ApiOperation({ summary: 'Cadastra um EAN para monitoramento (+ scan imediato)' })
  async create(@Body() body: unknown) {
    let dto;
    try {
      dto = createTrackedItemSchema.parse(body);
    } catch (e) {
      if (e instanceof ZodError) throw new BadRequestException(zodMessage(e));
      throw e;
    }
    let item;
    try {
      item = await this.itemModel.create(dto);
    } catch (e: any) {
      if (e?.code === 11000) {
        throw new BadRequestException(`O EAN ${dto.ean} já está sendo monitorado`);
      }
      throw e;
    }
    // Scan imediato fire-and-forget: o preço aparece na tela segundos após cadastrar.
    void this.worker.scanEan(dto.ean).catch(() => undefined);
    return item;
  }

  @Get('items')
  @ApiOperation({ summary: 'Lista itens monitorados com estado atual (preço, média, isDeal)' })
  async list() {
    return this.query.listItems();
  }

  @Patch('items/:id')
  @ApiOperation({ summary: 'Edita nome/teto/threshold/ativo de um item monitorado' })
  async update(@Param('id') id: string, @Body() body: unknown) {
    let patch;
    try {
      patch = updateTrackedItemSchema.parse(body);
    } catch (e) {
      if (e instanceof ZodError) throw new BadRequestException(zodMessage(e));
      throw e;
    }
    const updated = await this.itemModel
      .findByIdAndUpdate(id, { $set: patch }, { new: true })
      .lean()
      .exec();
    if (!updated) throw new NotFoundException('Item monitorado não encontrado');
    return updated;
  }

  @Delete('items/:id')
  @ApiOperation({ summary: 'Remove item monitorado (histórico do EAN permanece)' })
  async remove(@Param('id') id: string) {
    const removed = await this.itemModel.findByIdAndDelete(id).lean().exec();
    if (!removed) throw new NotFoundException('Item monitorado não encontrado');
    return { removed: true };
  }

  @Get('items/:id/history')
  @ApiOperation({ summary: 'Histórico de preços para o gráfico (+ média móvel, all-time low)' })
  async history(@Param('id') id: string, @Query('days') days?: string) {
    const parsed = Number(days ?? 30);
    const window = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 365) : 30;
    return this.query.history(id, window);
  }

  @Get('deals')
  @ApiOperation({ summary: 'Itens atualmente em oferta + alertas recentes' })
  async deals() {
    return this.query.deals();
  }

  @Post('items/:id/scan')
  @ApiOperation({ summary: 'Scan manual imediato (throttle 5min/item)' })
  async scan(@Param('id') id: string) {
    const last = this.lastManualScan.get(id) ?? 0;
    if (Date.now() - last < MANUAL_SCAN_COOLDOWN_MS) {
      throw new HttpException(
        'Aguarde alguns minutos antes de atualizar este item novamente',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const item = await this.itemModel.findById(id).lean().exec();
    if (!item) throw new NotFoundException('Item monitorado não encontrado');
    this.lastManualScan.set(id, Date.now());
    await this.worker.scanEan((item as any).ean);
    return { scanned: true };
  }
}
