import { Injectable, Logger } from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Model, Types, Connection } from 'mongoose';
import { XMLParser } from 'fast-xml-parser';
import { FiscalEntryModel } from '../schemas/fiscal-entry.schema';
import { SupplierMappingModel } from '../schemas/supplier-mapping.schema';
import { ProductModel } from '../../product/schemas/product.schema';
import { BrandModel } from '../../product/schemas/brand.schema';
import { STOCK_WRITE_PORT, StockWritePort } from '../../stock/ports/stock-write.port';
import { StockMovementType } from '../../stock-shared/movement-type';
import { buildUniqueProductSlug } from '../../product/utils/product-slug.util';
import { PRICING_PORT, PricingPort } from '../../pricing/ports/pricing.port';
import { ProductService } from '../../product/product.service';
import { ProductDraftsService } from '../../ai/product-drafts.service';
import { FinancialService } from '../../financial/services/financial.service';
import { Inject } from '@nestjs/common';

@Injectable()
export class NfeImportService {
    private readonly logger = new Logger(NfeImportService.name);
    private readonly parser: XMLParser;

    constructor(
        @InjectModel(FiscalEntryModel.name) private fiscalEntryModel: Model<FiscalEntryModel>,
        @InjectModel(SupplierMappingModel.name) private supplierMappingModel: Model<SupplierMappingModel>,
        @InjectModel(ProductModel.name) private productModel: Model<ProductModel>,
        @InjectModel(BrandModel.name) private brandModel: Model<BrandModel>,
        @Inject(STOCK_WRITE_PORT) private readonly stockService: StockWritePort,
        @Inject(PRICING_PORT) private readonly pricing: PricingPort,
        private readonly productService: ProductService,
        private readonly productDraftsService: ProductDraftsService,
        private readonly financialService: FinancialService,
        @InjectConnection() private readonly connection: Connection,
    ) {
        this.parser = new XMLParser({
            ignoreAttributes: false,
            removeNSPrefix: true,
        });
    }

    async processXml(xml: string): Promise<FiscalEntryModel> {
        this.logger.log('Processing NFe XML...');

        let parsed: any;
        try {
            parsed = this.parser.parse(xml);
        } catch (e) {
            this.logger.error('Failed to parse XML', e);
            throw new Error('Invalid XML Format');
        }

        const nfeProc = parsed.nfeProc || parsed.NFe; // Handle signed or unsigned
        const infNFe = nfeProc?.NFe?.infNFe || nfeProc?.infNFe;

        if (!infNFe) {
            throw new Error('Invalid NFe Structure: infNFe not found');
        }

        const accessKey = infNFe['@_Id']?.replace('NFe', '') || '';
        const emit = infNFe.emit;
        const detList = Array.isArray(infNFe.det) ? infNFe.det : [infNFe.det];
        const dateStr = infNFe.ide.dhEmi || infNFe.ide.dEmi;

        // 1. Check if already exists
        const existing = await this.fiscalEntryModel.findOne({ accessKey });
        if (existing) {
            this.logger.warn(`NFe ${accessKey} already imported.`);
            return existing;
        }

        // 2. Map Items
        const items = await Promise.all(detList.map(async (det: any) => {
            const prod = det.prod;
            const imposto = det.imposto;

            // Tax Parsing (Comprehensive)
            const taxes = {
                icms: { cst: '000', origin: '0', mode: '0', base: 0, rate: 0, value: 0, modeSt: '0', baseSt: 0, rateSt: 0, valueSt: 0, vBCFCP: 0, pFCP: 0, vFCP: 0, vBCFCPST: 0, pFCPST: 0, vFCPST: 0 },
                ipi: { cst: '', code: '', base: 0, rate: 0, value: 0 },
                pis: { cst: '', base: 0, rate: 0, value: 0 },
                cofins: { cst: '', base: 0, rate: 0, value: 0 },
                ii: { base: 0, despAdu: 0, value: 0, iof: 0 }
            };

            // ICMS
            if (imposto?.ICMS) {
                const icmsKey = Object.keys(imposto.ICMS)[0];
                const icmsObj = imposto.ICMS[icmsKey];

                taxes.icms.origin = icmsObj.orig || '0';
                taxes.icms.cst = icmsObj.CST || icmsObj.CSOSN || '000';
                taxes.icms.mode = icmsObj.modBC || '0';
                taxes.icms.base = parseFloat(icmsObj.vBC || 0);
                taxes.icms.rate = parseFloat(icmsObj.pICMS || 0);
                taxes.icms.value = parseFloat(icmsObj.vICMS || 0);

                taxes.icms.modeSt = icmsObj.modBCST || '0';
                taxes.icms.baseSt = parseFloat(icmsObj.vBCST || 0);
                taxes.icms.rateSt = parseFloat(icmsObj.pICMSST || 0);
                taxes.icms.valueSt = parseFloat(icmsObj.vICMSST || 0);

                taxes.icms.vBCFCP = parseFloat(icmsObj.vBCFCP || 0);
                taxes.icms.pFCP = parseFloat(icmsObj.pFCP || 0);
                taxes.icms.vFCP = parseFloat(icmsObj.vFCP || 0);
            }

            // IPI
            if (imposto?.IPI) {
                taxes.ipi.code = imposto.IPI.clEnq || '';
                taxes.ipi.cst = imposto.IPI.IPITrib?.CST || imposto.IPI.IPINT?.CST || '';
                if (imposto.IPI.IPITrib) {
                    taxes.ipi.base = parseFloat(imposto.IPI.IPITrib.vBC || 0);
                    taxes.ipi.rate = parseFloat(imposto.IPI.IPITrib.pIPI || 0);
                    taxes.ipi.value = parseFloat(imposto.IPI.IPITrib.vIPI || 0);
                }
            }

            // PIS
            if (imposto?.PIS) {
                const pisKey = Object.keys(imposto.PIS)[0];
                const pisObj = imposto.PIS[pisKey];
                taxes.pis.cst = pisObj.CST || '';
                taxes.pis.base = parseFloat(pisObj.vBC || 0);
                taxes.pis.rate = parseFloat(pisObj.pPIS || 0);
                taxes.pis.value = parseFloat(pisObj.vPIS || 0);
            }

            // COFINS
            if (imposto?.COFINS) {
                const cofinsKey = Object.keys(imposto.COFINS)[0];
                const cofinsObj = imposto.COFINS[cofinsKey];
                taxes.cofins.cst = cofinsObj.CST || '';
                taxes.cofins.base = parseFloat(cofinsObj.vBC || 0);
                taxes.cofins.rate = parseFloat(cofinsObj.pCOFINS || 0);
                taxes.cofins.value = parseFloat(cofinsObj.vCOFINS || 0);
            }

            // II
            if (imposto?.II) {
                taxes.ii.base = parseFloat(imposto.II.vBC || 0);
                taxes.ii.despAdu = parseFloat(imposto.II.vDespAdu || 0);
                taxes.ii.value = parseFloat(imposto.II.vII || 0);
                taxes.ii.iof = parseFloat(imposto.II.vIOF || 0);
            }

            const ean = prod.cEAN !== 'SEM GTIN' && prod.cEAN ? prod.cEAN : null;



            const item = {
                code: prod.cProd,
                description: prod.xProd,
                ean: ean,
                ncm: prod.NCM,
                cst: taxes.icms.cst,
                cfop: prod.CFOP,
                unit: prod.uCom,
                quantityXml: parseFloat(prod.qCom),
                quantityPhysical: parseFloat(prod.qCom),
                valueUnit: parseFloat(prod.vUnCom),
                valueTotal: parseFloat(prod.vProd),
                taxes: taxes,
                conversionFactor: 1,
                status: 'BRAND_REVIEW',
                productId: null,
                // New Cost Components (Item Level)
                freight: parseFloat(prod.vFrete || 0),
                insurance: parseFloat(prod.vSeg || 0),
                discount: parseFloat(prod.vDesc || 0),
                otherExpenses: parseFloat(prod.vOutro || 0)
            };

            // 3. Try to Map
            const mapping = await this.supplierMappingModel.findOne({
                supplierCnpj: emit.CNPJ,
                supplierCode: prod.cProd
            });

            if (mapping) {
                item.productId = mapping.productId;
                item.conversionFactor = mapping.conversionFactor;
                item.status = 'MAPPED';
            } else {
                // heuristic: Try to find by EAN or PartNumber
                // This is a "suggestion" logic
                const searchCriteria: any[] = [{ partNumber: prod.cProd }];
                if (ean) {
                    searchCriteria.push({ barcode: ean });
                }

                const suggestedProduct = await this.productModel.findOne({
                    $or: searchCriteria
                });

                if (suggestedProduct) {
                    item.productId = suggestedProduct._id as any;
                    item.status = 'MAPPED'; // Auto-Link
                    this.logger.log(`Auto-mapped item ${prod.cProd} to product ${suggestedProduct.partNumber} via ${ean ? 'EAN' : 'PartNumber'}`);
                }
            }

            return item;
        }));

        // 4. Save
        // Financial & Operation Extraction
        const natOp = infNFe.ide.natOp;
        const finNFe = parseInt(infNFe.ide.finNFe || '1');

        let billing = undefined;
        if (infNFe.cobr) {
            const fat = infNFe.cobr.fat || {};
            const dups = infNFe.cobr.dup ? (Array.isArray(infNFe.cobr.dup) ? infNFe.cobr.dup : [infNFe.cobr.dup]) : [];

            billing = {
                invoiceNumber: fat.nFat || '',
                originalValue: parseFloat(fat.vOrig || 0),
                netValue: parseFloat(fat.vLiq || 0),
                installments: dups.map((d: any) => ({
                    number: d.nDup,
                    dueDate: new Date(d.dVenc),
                    value: parseFloat(d.vDup || 0)
                }))
            };
        }

        const newEntry = new this.fiscalEntryModel({
            accessKey,
            xml,
            supplier: {
                cnpj: emit.CNPJ,
                name: emit.xNome,
                ie: emit.IE
            },
            issueDate: new Date(dateStr),
            items,
            status: 'BRAND_REVIEW',
            processedAt: null,
            operation: {
                nature: natOp,
                purpose: finNFe
            },
            billing: billing
        });

        return await newEntry.save();
    }

    async finalizeEntry(id: string) {
        const entry = await this.fiscalEntryModel.findById(id);
        if (!entry) throw new Error('Fiscal Entry not found');

        if (entry.status !== 'VALIDATED' && entry.status !== 'PENDING') {
            // Already processed or invalid state
        }

        this.logger.log(`Finalizing Entry ${id} - ${entry.accessKey}`);

        const session = await this.connection.startSession();
        session.startTransaction();

        try {
            for (const item of entry.items) {
                // Handle Unmapped Items
                if (!item.productId) {
                    // If it has physical quantity > 0, we MUST have blocked it before or throw here
                    const physicalQty = (item.quantityPhysical !== null && item.quantityPhysical !== undefined)
                        ? item.quantityPhysical
                        : 0; // Default to 0 if not counted

                    if (physicalQty > 0) {
                        throw new Error(`Item ${item.description} (Code: ${item.code}) foi contado mas não está vinculado a um produto.`);
                    }

                    // If 0 quantity, we treat as Shortage/Ignored
                    item.status = 'SHORTAGE_ACCEPTED';
                    continue;
                }

                // FIX: Verify explicit physical quantity. If defined (even 0), use it. If null/undefined, use XML.
                const physicalQty = (item.quantityPhysical !== null && item.quantityPhysical !== undefined)
                    ? item.quantityPhysical
                    : item.quantityXml;

                const qty = physicalQty * (item.conversionFactor || 1);

                // If it's a shortage (qty < xml), mark as accepted
                if (physicalQty < item.quantityXml) {
                    item.status = 'SHORTAGE_ACCEPTED';
                } else {
                    item.status = 'PROCESSED';
                }

                // --- Calculate Landed Cost ---
                // Cost Calculation based on XML Quantity (Standard Cost of Acquisition)
                // Unit Cost = (Gross + Taxes + Expenses - Discounts) / XML_Qty

                const grossValue = item.valueTotal;

                // Tax Additions (IPI + ST usually add to cost, ICMS is credit - but for simplicity we treat ST as cost)
                // TODO: Depends on regime (Simples vs Real). Assuming standard cost logic for now where ST adds to cost.
                const taxAdditions = (item.taxes?.ipi?.value || 0) + (item.taxes?.icms?.valueSt || 0);

                // Expenses
                const expenses = (item.freight || 0) + (item.insurance || 0) + (item.otherExpenses || 0);

                // Deductions
                const deductions = (item.discount || 0);

                const totalCost = grossValue + taxAdditions + expenses - deductions;

                // Unit Cost per XML Unit
                // If quantityXml is 0 (should not happen), avoid NaN
                const qtyXml = item.quantityXml || 1;
                const unitCostXml = totalCost / qtyXml;

                // We need the cost per STOCK unit (e.g. per piece, not per box)
                const conversion = item.conversionFactor || 1;
                const unitCostStock = unitCostXml / conversion;

                if (qty > 0) {
                    // Create Stock Movement (Inbound) passing the SESSION
                    await this.stockService.move({
                        productId: item.productId.toString(),
                        type: StockMovementType.INBOUND,
                        quantity: qty,
                        unitCost: unitCostStock, // Precise Landed Cost → lot cost
                        reason: `NF-e Import ${entry.accessKey.slice(0, 8)}`,
                        reference: entry.accessKey,
                        condition: 'new',
                    }, session);

                    const product = await this.productModel.findById(item.productId).session(session);
                    if (product) {

                        // Recalculate Per-Stock-Unit components for the record
                        const factor = (item.quantityXml * (item.conversionFactor || 1));
                        const freightUnit = (item.freight || 0) / factor;
                        const otherUnit = (item.otherExpenses || 0) / factor;

                        product.lastPurchase = {
                            date: entry.issueDate,
                            supplierCnpj: entry.supplier.cnpj,
                            supplierName: entry.supplier.name,
                            costPrice: item.valueUnit / (item.conversionFactor || 1), // Base Invoice Price
                            freightCost: freightUnit,
                            otherExpenses: otherUnit,
                            taxes: {
                                icms: {
                                    cst: item.taxes.icms.cst,
                                    origin: item.taxes.icms.origin,
                                    base: item.taxes.icms.base,
                                    rate: item.taxes.icms.rate,
                                    value: item.taxes.icms.value,
                                    valueSt: item.taxes.icms.valueSt,
                                },
                                ipi: {
                                    cst: item.taxes.ipi.cst || '',
                                    base: item.taxes.ipi.base || 0,
                                    rate: item.taxes.ipi.rate || 0,
                                    value: item.taxes.ipi.value || 0,
                                },
                                pis: {
                                    cst: item.taxes.pis.cst || '',
                                    base: item.taxes.pis.base || 0,
                                    rate: item.taxes.pis.rate || 0,
                                    value: item.taxes.pis.value || 0,
                                },
                                cofins: {
                                    cst: item.taxes.cofins.cst || '',
                                    base: item.taxes.cofins.base || 0,
                                    rate: item.taxes.cofins.rate || 0,
                                    value: item.taxes.cofins.value || 0,
                                }
                            },
                            finalCost: unitCostStock
                        };

                        // Cost is no longer stored on the product — the inbound above wrote it to
                        // the stock lot (StockService). lastPurchase is kept as a fiscal/supplier audit record.

                        // We do NOT update the Sales Price (product.price) here anymore.
                        // The User has already defined/reviewed the prices in the Pricing Tab.
                        // Even if autoUpdate is true, we respect the "Defined Pricing" from the specific NFe flow.
                        // If they want to re-calc based on new accurate cost, they should do it in the Pricing Tab interactions.

                        await product.save({ session });
                    }
                }

                if (item.status !== 'SHORTAGE_ACCEPTED') {
                    item.status = 'PROCESSED';
                }
            }

            entry.status = 'PROCESSED';
            entry.processedAt = new Date();
            await entry.save({ session });

            // Generate Financial Transactions (Accounts Payable)
            // Passing session ensures they are created atomically with stock movements
            await this.financialService.createFromFiscalEntry(entry as any, session);

            await session.commitTransaction();
            return entry;

        } catch (error) {
            await session.abortTransaction();
            this.logger.error(`Failed to finalize entry ${id}: ${error.message}`);
            throw error;
        } finally {
            session.endSession();
        }
    }

    async createProductFromFiscalItem(entryId: string, itemCode: string, brandName?: string): Promise<any> {
        const entry = await this.fiscalEntryModel.findById(entryId);
        if (!entry) throw new Error('Fiscal Entry not found');

        const item = entry.items.find(i => i.code === itemCode);
        if (!item) throw new Error('Item not found');

        // Check if already mapped?
        if (item.productId) throw new Error('Item already mapped to a product.');

        // 1. Create Product DRAFT
        // We use supplier code as PartNumber initially
        // Store relevant data in 'data' field as JSON
        const draftData = {
            partNumber: item.code,
            name: item.description,
            description: '',
            price: (item.valueUnit * 1.5).toFixed(2),
            costPrice: item.valueUnit,
            brandName: brandName,
            fiscalEntryId: entry._id.toString(),
            itemCode: item.code
        };

        const newDraft = await this.productDraftsService.create({
            batchId: `NFE-${entry.accessKey.slice(0, 8)}`,
            status: 'pending',
            data: JSON.stringify(draftData),
            sourceImageUrl: '', // No image in XML usually
        });

        // 2. Do NOT auto-map yet. 
        // We leave the item as PENDING (or maybe set to DRAFT_CREATED if we add that status).
        // For now, let's just log and return the draft.
        this.logger.log(`Created Draft ${newDraft._id} for item ${itemCode}`);

        return newDraft;
    }


    async autoLinkItems(entryId: string): Promise<any> {
        const entry = await this.fiscalEntryModel.findById(entryId);
        if (!entry) throw new Error('Fiscal Entry not found');

        let linkedCount = 0;
        const supplierName = entry.supplier.name.toLowerCase();

        for (const item of entry.items) {
            if (item.status !== 'PENDING') continue;
            if (item.productId) continue;

            const candidates = await this.productModel.find({
                partNumber: item.code
            });

            if (candidates.length === 0) continue;

            const matched = candidates.find(p => {
                if (!p.brand || !p.brand.name) return false;
                const brand = p.brand.name.toLowerCase();
                return supplierName.includes(brand) || brand.includes(supplierName);
            });

            if (matched) {
                item.productId = matched._id as any;
                item.status = 'MAPPED';
                item.conversionFactor = 1;
                linkedCount++;

                await this.supplierMappingModel.updateOne(
                    {
                        supplierCnpj: entry.supplier.cnpj,
                        supplierCode: item.code
                    },
                    {
                        supplierCnpj: entry.supplier.cnpj,
                        supplierCode: item.code,
                        supplierName: entry.supplier.name,
                        productId: matched._id,
                        conversionFactor: 1
                    },
                    { upsert: true }
                );

                this.logger.log(`Auto-linked item ${item.code} to product ${matched.partNumber}`);
            }
        }

        if (linkedCount > 0) {
            const allMapped = entry.items.every(i => i.status !== 'PENDING');
            if (allMapped && entry.status === 'PENDING') {
                entry.status = 'VALIDATED';
            }
            await entry.save();
        }

        return { linkedCount, message: `${linkedCount} items auto-linked.` };
    }

    async createAutomaticProduct(xmlItem: any, brandName?: string): Promise<any> {
        // Build Query - Case Insensitive PartNumber
        const query: any = {
            partNumber: { $regex: new RegExp(`^${xmlItem.code}$`, 'i') }
        };

        // If Brand provided, filter by it (case insensitive)
        if (brandName) {
            query['brand.name'] = { $regex: new RegExp(`^${brandName}$`, 'i') };
        }

        // Check availability
        const existing = await this.productModel.findOne(query);
        if (existing) {
            this.logger.log(`createAutomaticProduct: Found existing product for code ${xmlItem.code}, using it.`);
            return existing;
        }

        const slug = await buildUniqueProductSlug(
            { name: xmlItem.description, partNumber: xmlItem.code },
            async (candidate) => !!(await this.productModel.findOne({ slug: candidate })),
        );

        // Generate Barcode Fallback
        let barcode = xmlItem.ean;
        if (!barcode || barcode === 'SEM GTIN') {
            const brandSlug = (brandName || 'generic').toLowerCase().replace(/[^a-z0-9]+/g, '-');
            barcode = `${xmlItem.code}-${brandSlug}`;
        }

        // --- BRAND SYNC LOGIC ---
        // Prepare Brand Object for Product
        const brandObj: any = {
            name: brandName,
            isGenuine: false,
            shortName: brandName,
            amazonName: brandName,
            fullName: brandName,
            externalId: '',
            logoUrl: ''
        };

        if (brandName && brandName !== 'GENERIC') {
            // Check if Master Brand exists
            let masterBrand = await this.brandModel.findOne({ name: { $regex: new RegExp(`^${brandName}$`, 'i') } });

            if (masterBrand) {
                // Use Authoritative Data
                brandObj.name = masterBrand.name;
                brandObj.isGenuine = masterBrand.isGenuine;
                brandObj.shortName = masterBrand.shortName || masterBrand.name;
                brandObj.amazonName = masterBrand.amazonName || masterBrand.name;
                brandObj.fullName = masterBrand.fullName || masterBrand.name;
                brandObj.logoUrl = masterBrand.logoUrl || '';
                brandObj.externalId = masterBrand.id || masterBrand._id.toString();
            } else {
                // Create New Master Brand if it doesn't exist (Auto-Discovery)
                this.logger.log(`Brand '${brandName}' not found. Creating new Master Brand.`);
                masterBrand = new this.brandModel({
                    name: brandName,
                    active: true,
                    isGenuine: false, // Default to false until verified
                    shortName: brandName,
                    fullName: brandName
                });
                await masterBrand.save();
                // Update with new ID
                brandObj.externalId = masterBrand._id.toString();
            }
        } else {
            // Fallback for Generic
            brandObj.name = 'GENERIC';
            brandObj.shortName = 'GENERIC';
            brandObj.fullName = 'GENERIC';
        }

        const newProduct = new this.productModel({
            name: xmlItem.description,
            partNumber: xmlItem.code,
            sku: xmlItem.code,
            barcode: barcode,
            slug: slug,
            brand: brandObj,
            unit: {
                code: xmlItem.unit,
                name: xmlItem.unit
            },
            // cost lives on the stock lot (inbound); sale price lives in PricingModule (set below)
            active: true,
            schemaVersion: 1,
            images: [],
            titles: [],
            attributes: [],
            allocations: [],
        });

        const saved = await newProduct.save();
        // Provisional sale price (custo * 1.5) → PricingModule base price + markup metadata.
        const provisional = (xmlItem.valueUnit || 0) * 1.5;
        await this.pricing.setBasePrice(String(saved._id), provisional);
        await this.pricing.setPricingMeta(String(saved._id), { markup: 1.5, profitMargin: 0.33, strategy: 'MANUAL' });
        return saved;
    }
}
