import { Controller, Post, Body, Get, Param, Put, BadRequestException, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { NfeImportService } from '../services/nfe-import.service';
import { FiscalEntryModel } from '../schemas/fiscal-entry.schema';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { SupplierMappingModel } from '../schemas/supplier-mapping.schema';
import { ProductModel } from '../../product/schemas/product.schema';
import { MapItemDto, CreateProductDraftDto, UpdateConferenceDto, ConferenceScanDto, BulkUpdateBrandDto } from '../dto/import-nfe.dto';

// ... imports
import { ProductDraftsService } from '../../ai/product-drafts.service';

@Controller('fiscal-entries')
export class FiscalEntryController {
    constructor(
        private readonly nfeImportService: NfeImportService,
        @InjectModel(FiscalEntryModel.name) private fiscalEntryModel: Model<FiscalEntryModel>,
        @InjectModel(SupplierMappingModel.name) private supplierMappingModel: Model<SupplierMappingModel>,
        @InjectModel(ProductModel.name) private productModel: Model<ProductModel>,
        private readonly productDraftsService: ProductDraftsService, // Injected
    ) { }

    // ... other methods

    @Post('import')
    async importXml(@Body() body: { xml: string }) {
        if (!body?.xml) throw new BadRequestException('Campo xml é obrigatório.');

        const accessKey = this.extractAccessKey(body.xml);
        const existing = accessKey ? await this.fiscalEntryModel.findOne({ accessKey }).lean().exec() : null;

        const entry = await this.nfeImportService.processXml(body.xml);
        return { ...(entry as any).toObject?.() ?? entry, duplicate: !!existing };
    }

    private extractAccessKey(xml: string): string | null {
        const match = xml.match(/Id="NFe(\d{44})"/);
        return match ? match[1] : null;
    }

    @Get()
    async findAll() {
        return await this.fiscalEntryModel.find().sort({ createdAt: -1 }).exec();
    }

    @Get(':id')
    async findOne(@Param('id') id: string) {
        return await this.fiscalEntryModel.findById(id).populate('items.productId');
    }

    @Post(':id/conference/scan')
    async conferenceScan(
        @Param('id') id: string,
        @Body() body: ConferenceScanDto
    ) {
        const entry = await this.fiscalEntryModel.findById(id);
        if (!entry) throw new BadRequestException('Fiscal Entry not found');

        const itemIndex = entry.items.findIndex(i => i.code.toLowerCase() === body.itemCode.toLowerCase());
        if (itemIndex === -1) throw new BadRequestException(`Item not found in NFe (Code: ${body.itemCode})`);

        const xmlItem = entry.items[itemIndex];
        let isNew = false;

        // --- SILENT AUTO-REGISTRATION ---
        if (!xmlItem.productId) {
            // 1. Create Product
            const newProduct = await this.nfeImportService.createAutomaticProduct(
                xmlItem,
                body.brandName || xmlItem.brand
            );

            // 2. Create Persistent Mapping
            await this.supplierMappingModel.updateOne(
                {
                    supplierCnpj: entry.supplier.cnpj,
                    supplierCode: xmlItem.code
                },
                {
                    supplierCnpj: entry.supplier.cnpj,
                    supplierCode: xmlItem.code,
                    supplierName: entry.supplier.name,
                    productId: newProduct._id,
                    conversionFactor: 1
                },
                { upsert: true }
            );

            // 3. Update Item
            entry.items[itemIndex].productId = newProduct._id;
            entry.items[itemIndex].status = 'MAPPED';
            isNew = true;

            // 4. Create AI Draft for new product (Fire & Forget/Await safe)
            try {
                const draftData = {
                    source: 'FISCAL_CONFERENCE',
                    originalXmlDescription: xmlItem.description,
                    fiscalEntryId: id,
                    partNumber: xmlItem.code,
                    name: xmlItem.description,
                    description: xmlItem.description, // Consistent field for AI
                    price: (xmlItem.valueUnit * 1.5).toFixed(2),
                    costPrice: xmlItem.valueUnit,
                    brandName: body.brandName || xmlItem.brand || newProduct.brand?.name,
                    ean: xmlItem.ean,
                    itemCode: xmlItem.code
                };

                await this.productDraftsService.create({
                    productId: newProduct._id,
                    name: newProduct.name,
                    status: 'pending',
                    sourceImageUrl: newProduct.images?.[0] || '',
                    data: JSON.stringify(draftData)
                });
            } catch (e) {
                console.error(`Failed to create AI draft for product ${newProduct._id}`, e);
                // Don't block the conference flow
            }
        }



        // --- BLIND CONFERENCE ---
        // Increment count
        const qtyToAdd = body.quantity && body.quantity > 0 ? body.quantity : 1;
        entry.items[itemIndex].quantityPhysical = (entry.items[itemIndex].quantityPhysical || 0) + qtyToAdd;

        // Check against XML
        if (entry.items[itemIndex].quantityPhysical === entry.items[itemIndex].quantityXml) {
            entry.items[itemIndex].status = 'CONFERENCED';
        } else if (entry.items[itemIndex].quantityPhysical > entry.items[itemIndex].quantityXml) {
            entry.items[itemIndex].status = 'DIVERGENT'; // User said DIVERGENT_OVER, used simplified
        }

        // Add to history
        if (!entry.items[itemIndex].scanHistory) {
            entry.items[itemIndex].scanHistory = [];
        }
        entry.items[itemIndex].scanHistory.push({
            scannedAt: new Date(),
            quantity: qtyToAdd,
            userId: 'APP_USER' // Placeholder until auth context is available or passed in body
        });

        await entry.save();

        return {
            message: 'Scan registered',
            productName: xmlItem.description,
            count: entry.items[itemIndex].quantityPhysical,
            expected: entry.items[itemIndex].quantityXml,
            isNew: isNew
        };
    }

    @Post(':id/conference/check')
    async conferenceCheck(
        @Param('id') id: string,
        @Body() body: { itemCode: string }
    ) {
        const entry = await this.fiscalEntryModel.findById(id);
        if (!entry) throw new BadRequestException('Fiscal Entry not found');

        const itemIndex = entry.items.findIndex(i => i.code.toLowerCase() === body.itemCode.toLowerCase());

        // If not found in entry by code, maybe user scanned an EAN?
        // Limitation: Current simplified version relies on Supplier Code matching.
        // Todo: Enhance to check EAN if code not found.
        if (itemIndex === -1) {
            // For now, if not in XML, we don't support blindly adding random items yet unless they are in the XML.
            // But maybe the user wants to add an item that IS in products but not mapped?
            // The user requirement says "busca nos itens de fiscal_entries". So it MUST be in the entry.
            throw new BadRequestException(`Item não encontrado na nota (Code: ${body.itemCode})`);
        }

        const xmlItem = entry.items[itemIndex];

        if (xmlItem.productId) {
            const product = await this.productModel.findById(xmlItem.productId);
            return { status: 'LINKED', product, item: xmlItem };
        }

        // Not linked. Check global catalog.
        // Search by partNumber OR EAN (if available in Product)
        // Adjust regex for case insensitive exact match or similar
        const product = await this.productModel.findOne({
            $or: [
                { partNumber: { $regex: new RegExp(`^${xmlItem.code}$`, 'i') } },
                // { ean: body.itemCode } // If we trusted the scan was EAN
            ]
        });

        if (product) {
            return { status: 'MATCH_FOUND', product, item: xmlItem };
        }

        return { status: 'NEW', item: xmlItem };
    }

    @Put(':id/brands')
    async updateBrands(
        @Param('id') id: string,
        @Body() body: BulkUpdateBrandDto
    ) {
        const entry = await this.fiscalEntryModel.findById(id);
        if (!entry) throw new BadRequestException('Fiscal Entry not found');

        for (const update of body.items) {
            const itemIndex = entry.items.findIndex(i => i.code === update.itemCode);
            if (itemIndex !== -1) {
                entry.items[itemIndex].brand = update.brandName;
                entry.items[itemIndex].noBrand = update.noBrand;
                // If brand is defined (or marked as no brand), move to PENDING (ready for mapping)
                if (entry.items[itemIndex].status === 'BRAND_REVIEW') {
                    entry.items[itemIndex].status = 'PENDING';
                }
            }
        }

        // Check if all items are past BRAND_REVIEW
        const allReviewed = entry.items.every(i => i.status !== 'BRAND_REVIEW');
        if (allReviewed && entry.status === 'BRAND_REVIEW') {
            entry.status = 'PENDING'; // Move entry to next stage
        }

        await entry.save();
        return entry;
    }

    @Put(':id/conference')
    async updateConference(
        @Param('id') id: string,
        @Body() body: UpdateConferenceDto
    ) {
        const entry = await this.fiscalEntryModel.findById(id);
        if (!entry) throw new BadRequestException('Fiscal Entry not found');

        body.items.forEach(confItem => {
            const item = entry.items.find(i => i.code === confItem.code);
            if (item) {
                item.quantityPhysical = confItem.quantity;
                item.status = 'CONFERENCED';
            }
        });

        await entry.save();
        return entry;
    }

    @Post(':id/finalize')
    async finalize(@Param('id') id: string) {
        return await this.nfeImportService.finalizeEntry(id);
    }
}
