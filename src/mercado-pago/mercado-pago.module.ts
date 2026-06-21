import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  MpBalanceSnapshotModel,
  MpBalanceSnapshotSchema,
} from './schemas/mp-balance-snapshot.schema';
import { MercadoPagoClient } from './mercado-pago.client';
import { MercadoPagoBalanceService } from './mercado-pago-balance.service';
import { MercadoPagoBalanceScheduler } from './mercado-pago-balance.scheduler';

/**
 * Módulo dedicado ao Mercado Pago. Por ora cobre o saldo (disponível + a liberar).
 *
 * Depende do MarketplaceCredentialsService (@Global) para resolver o token MP nativo.
 * Exporta o MercadoPagoBalanceService para integradores (ex.: bridge do WhatsApp).
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MpBalanceSnapshotModel.name, schema: MpBalanceSnapshotSchema },
    ]),
  ],
  providers: [MercadoPagoClient, MercadoPagoBalanceService, MercadoPagoBalanceScheduler],
  exports: [MercadoPagoBalanceService],
})
export class MercadoPagoModule {}
