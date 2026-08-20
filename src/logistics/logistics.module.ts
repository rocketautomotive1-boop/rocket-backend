import { Module } from '@nestjs/common';

import { HttpModule } from '@nestjs/axios';
import { LogisticsController } from './logistics.controller';
import { FreightService } from './freight/freight.service';
import { FedExProvider } from './freight/providers/fedex/fedex.provider';
import { JamefProvider } from './freight/providers/jamef/jamef.provider';
import { TokenManagerService } from './freight/token/token-manager.service';

import { AzulCargoProvider } from './freight/providers/azul/azul-cargo.provider';
import { CorreiosProvider } from './freight/providers/correios/correios.provider';
import { UberProvider } from './freight/providers/uber/uber.provider';

@Module({
    imports: [
        HttpModule,
    ],
    controllers: [LogisticsController],
    providers: [
        FreightService,
        FedExProvider,
        JamefProvider,
        AzulCargoProvider,
        CorreiosProvider,
        UberProvider,
        TokenManagerService,
    ],
    exports: [FreightService],
})
export class LogisticsModule { }
