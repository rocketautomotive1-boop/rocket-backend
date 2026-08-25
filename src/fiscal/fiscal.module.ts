import { Module } from '@nestjs/common';

import { FiscalController } from './fiscal.controller';
import { FiscalEntryController } from './controllers/fiscal-entry.controller';
import { FiscalService } from './services/fiscal.service';
import { XmlBuilderService } from './services/xml-builder.service';
import { SignatureService } from './services/signature.service';
import { SefazService } from './services/sefaz.service';
import { NfeImportService } from './services/nfe-import.service';
import { FiscalIssuanceRequestService } from './services/fiscal-issuance-request.service';
import { FiscalDanfeService } from './services/fiscal-danfe.service';
import { FiscalIssuanceConsumer } from './consumers/fiscal-issuance.consumer';
import { FiscalIssuanceOrderListener } from './listeners/fiscal-issuance-order.listener';
import { FiscalMlAttachListener } from './listeners/fiscal-ml-attach.listener';
import { DanfeQrCodeService } from './services/danfe-qrcode.service';
import { EpecSyncWorker } from './services/epec-sync.worker';
// import { Order } from '../order/schemas/order.schema';


import { HttpModule } from '@nestjs/axios';
import { ProductModule } from '../product/product.module';
import { MarketplaceModule } from '../marketplace/marketplace.module';
import { AiModule } from '../ai/ai.module';
import { LegalEntityModule } from '../legal-entity/legal-entity.module';
import { FiscalCustomerModule } from '../fiscal-customer/fiscal-customer.module';
import { OutboxModule } from '../outbox/outbox.module';
import { S3Module } from '../common/s3/s3.module';
import { MongooseModule } from '@nestjs/mongoose';
import { ProductModel, ProductSchema } from '../product/schemas/product.schema';
import { FiscalDocumentModel, FiscalDocumentSchema, FiscalInutilizationModel, FiscalInutilizationSchema } from './schemas/fiscal.schema';
import { OrderModel, OrderSchema } from '../order/schemas/order.schema';
import { FiscalEntryModel, FiscalEntrySchema } from './schemas/fiscal-entry.schema';
import { SupplierMappingModel, SupplierMappingSchema } from './schemas/supplier-mapping.schema';
import { FinancialModule } from '../financial/financial.module';
import { BrandModel, BrandSchema } from '../product/schemas/brand.schema';

@Module({
    imports: [
        HttpModule,
        MongooseModule.forFeature([
            { name: FiscalDocumentModel.name, schema: FiscalDocumentSchema },
            { name: FiscalInutilizationModel.name, schema: FiscalInutilizationSchema },
            { name: OrderModel.name, schema: OrderSchema },
            { name: FiscalEntryModel.name, schema: FiscalEntrySchema },
            { name: SupplierMappingModel.name, schema: SupplierMappingSchema },
            { name: ProductModel.name, schema: ProductSchema },
            { name: BrandModel.name, schema: BrandSchema },
        ]),
        ProductModule,
        MarketplaceModule,
        AiModule,
        FinancialModule,
        LegalEntityModule, // StorePort/StoreModule é @Global — não precisa import explícito aqui
        FiscalCustomerModule,
        OutboxModule, // FiscalIssuanceRequestService enfileira via OutboxRepository
        S3Module, // FiscalDanfeService faz upload do DANFE
    ],
    controllers: [FiscalController, FiscalEntryController],
    providers: [
        FiscalService,
        XmlBuilderService,
        SignatureService,
        SefazService,
        NfeImportService,
        FiscalIssuanceRequestService,
        FiscalDanfeService,
        DanfeQrCodeService,
        FiscalIssuanceConsumer,
        FiscalIssuanceOrderListener,
        FiscalMlAttachListener,
        EpecSyncWorker,
    ],
    exports: [FiscalService, NfeImportService, FiscalIssuanceRequestService],
})
export class FiscalModule { }
