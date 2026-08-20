import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LegalEntityModel, LegalEntitySchema } from './schemas/legal-entity.schema';
import { LegalEntityService } from './services/legal-entity.service';
import { CertificateInspectionService } from './services/certificate-inspection.service';
import { CertificateExpiryCheckWorker } from './services/certificate-expiry-check.worker';
import { LegalEntityController } from './legal-entity.controller';
import { SignatureService } from '../fiscal/services/signature.service';
import { DocumentLookupModule } from '../document-lookup/document-lookup.module';

@Module({
    imports: [
        MongooseModule.forFeature([{ name: LegalEntityModel.name, schema: LegalEntitySchema }]),
        DocumentLookupModule,
    ],
    controllers: [LegalEntityController],
    providers: [LegalEntityService, CertificateInspectionService, SignatureService, CertificateExpiryCheckWorker],
    exports: [LegalEntityService],
})
export class LegalEntityModule { }
