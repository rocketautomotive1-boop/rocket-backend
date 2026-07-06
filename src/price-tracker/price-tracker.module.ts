import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TrackedItemModel, TrackedItemSchema } from './schemas/tracked-item.schema';
import { PriceHistoryModel, PriceHistorySchema } from './schemas/price-history.schema';
import { PriceAlertModel, PriceAlertSchema } from './schemas/price-alert.schema';
import { CurrentOffersModel, CurrentOffersSchema } from './schemas/current-offers.schema';
import { MenorPrecoClientService } from './scraper/menor-preco-client.service';
import { MenorPrecoTrackerResultConsumer } from './scraper/menor-preco-tracker-result.consumer';
import { PriceAlertService } from './alerts/price-alert.service';
import { PriceTrackerScanWorker } from './workers/price-tracker-scan.worker';
import { PriceTrackerQueryService } from './price-tracker-query.service';
import { PriceTrackerController } from './price-tracker.controller';

/**
 * Caçador de Promoções: monitora EANs via serviço Menor Preço (scraper), acumula
 * histórico e alerta oportunidades reais. Spec: docs/superpowers/specs/2026-07-05-*.md
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TrackedItemModel.name, schema: TrackedItemSchema },
      { name: PriceHistoryModel.name, schema: PriceHistorySchema },
      { name: PriceAlertModel.name, schema: PriceAlertSchema },
      { name: CurrentOffersModel.name, schema: CurrentOffersSchema },
    ]),
  ],
  controllers: [PriceTrackerController],
  providers: [
    MenorPrecoClientService,
    MenorPrecoTrackerResultConsumer,
    PriceAlertService,
    PriceTrackerScanWorker,
    PriceTrackerQueryService,
  ],
})
export class PriceTrackerModule {}
