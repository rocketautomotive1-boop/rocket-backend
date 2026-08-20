import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { SignatureService } from '../fiscal/services/signature.service';
import { DocumentLookupController } from './document-lookup.controller';
import { DocumentLookupService } from './services/document-lookup.service';
import { BrasilApiCnpjAdapter } from './adapters/brasil-api-cnpj.adapter';
import { CpfLookupAdapter } from './adapters/cpf-lookup.adapter';
import { SefazCadConsultaCadastroAdapter } from './adapters/sefaz-cad-consulta-cadastro.adapter';
import { CccLookupService } from './adapters/ccc-lookup.service';
import { CNPJ_LOOKUP_PORT } from './ports/cnpj-lookup.port';
import { CPF_LOOKUP_PORT } from './ports/cpf-lookup.port';
import { DocumentLookupAuditModel, DocumentLookupAuditSchema } from './schemas/document-lookup-audit.schema';

@Module({
    imports: [
        HttpModule,
        ConfigModule,
        AuthModule,
        MongooseModule.forFeature([{ name: DocumentLookupAuditModel.name, schema: DocumentLookupAuditSchema }]),
    ],
    controllers: [DocumentLookupController],
    providers: [
        DocumentLookupService,
        SignatureService,
        BrasilApiCnpjAdapter,
        CpfLookupAdapter,
        SefazCadConsultaCadastroAdapter,
        CccLookupService,
        { provide: CNPJ_LOOKUP_PORT, useExisting: BrasilApiCnpjAdapter },
        { provide: CPF_LOOKUP_PORT, useExisting: CpfLookupAdapter },
    ],
    exports: [DocumentLookupService, SefazCadConsultaCadastroAdapter, CccLookupService],
})
export class DocumentLookupModule { }
