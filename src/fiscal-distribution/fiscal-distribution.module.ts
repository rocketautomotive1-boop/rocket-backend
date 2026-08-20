import { Module, forwardRef } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { LegalEntityModel, LegalEntitySchema } from '../legal-entity/schemas/legal-entity.schema';
import { FiscalModule } from '../fiscal/fiscal.module';
import { SignatureService } from '../fiscal/services/signature.service';
import { NfeDistributionEventModel, NfeDistributionEventSchema, NfeDistributionCursorModel, NfeDistributionCursorSchema } from './schemas/nfe-distribution-event.schema';
import { NfeDistribuicaoClient } from './services/nfe-distribuicao.client';
import { NfeManifestacaoClient } from './services/nfe-manifestacao.client';
import { FiscalDistributionService } from './services/fiscal-distribution.service';
import { NfeDistributionPoller } from './nfe-distribution-poller.service';
import { FiscalDistributionController } from './fiscal-distribution.controller';

@Module({
    imports: [
        HttpModule,
        AuthModule,
        MongooseModule.forFeature([
            { name: NfeDistributionEventModel.name, schema: NfeDistributionEventSchema },
            { name: NfeDistributionCursorModel.name, schema: NfeDistributionCursorSchema },
            { name: LegalEntityModel.name, schema: LegalEntitySchema },
        ]),
        forwardRef(() => FiscalModule), // NfeImportService
    ],
    controllers: [FiscalDistributionController],
    providers: [
        SignatureService,
        NfeDistribuicaoClient,
        NfeManifestacaoClient,
        FiscalDistributionService,
        NfeDistributionPoller,
    ],
    exports: [FiscalDistributionService],
})
export class FiscalDistributionModule { }
