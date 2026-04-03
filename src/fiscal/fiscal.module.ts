import { Module, forwardRef } from '@nestjs/common';

import { FiscalController } from './fiscal.controller';
import { FiscalEntryController } from './controllers/fiscal-entry.controller';
import { FiscalService } from './services/fiscal.service';
import { XmlBuilderService } from './services/xml-builder.service';
import { SignatureService } from './services/signature.service';
import { SefazService } from './services/sefaz.service';
import { NfeImportService } from './services/nfe-import.service';
// import { Order } from '../order/schemas/order.schema'; 


import { HttpModule } from '@nestjs/axios';
import { ProductModule } from '../product/product.module';
import { MarketplaceModule } from '../marketplace/marketplace.module';
import { AiModule } from '../ai/ai.module';
import { MongooseModule } from '@nestjs/mongoose';
import { ProductModel, ProductSchema } from '../product/schemas/product.schema';
import { FiscalIssuerModel, FiscalIssuerSchema, FiscalDocumentModel, FiscalDocumentSchema } from './schemas/fiscal.schema';
import { OrderModel, OrderSchema } from '../order/schemas/order.schema';
import { FiscalEntryModel, FiscalEntrySchema } from './schemas/fiscal-entry.schema';
import { SupplierMappingModel, SupplierMappingSchema } from './schemas/supplier-mapping.schema';
import { FinancialModule } from '../financial/financial.module';
import { BrandModel, BrandSchema } from '../product/schemas/brand.schema';

@Module({
    imports: [
        HttpModule,
        MongooseModule.forFeature([
            { name: FiscalIssuerModel.name, schema: FiscalIssuerSchema },
            { name: FiscalDocumentModel.name, schema: FiscalDocumentSchema },
            { name: OrderModel.name, schema: OrderSchema },
            { name: FiscalEntryModel.name, schema: FiscalEntrySchema },
            { name: SupplierMappingModel.name, schema: SupplierMappingSchema },
            { name: ProductModel.name, schema: ProductSchema },
            { name: BrandModel.name, schema: BrandSchema },
        ]),
        forwardRef(() => ProductModule),
        forwardRef(() => MarketplaceModule),
        forwardRef(() => AiModule),
        FinancialModule,
    ],
    controllers: [FiscalController, FiscalEntryController],
    providers: [
        FiscalService,
        XmlBuilderService,
        SignatureService,
        SefazService,
        NfeImportService,
    ],
    exports: [FiscalService, NfeImportService],
})
export class FiscalModule { }
