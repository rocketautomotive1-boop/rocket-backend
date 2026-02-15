import { Injectable, Logger } from '@nestjs/common';
import { MarketplaceToken } from '../schemas/marketplace-token.schema';
import { MarketplaceRegistryService } from './marketplace-registry.service';
import { MarketplaceAuthService } from '../auth/services/marketplace-auth.service';
import { MarketplaceValidationResult, ValidationError } from '../interfaces/marketplace-validation-result.interface';
import { ProductDocument } from '../../product/product-types';
import { ProductModel } from '../../product/schemas/product.schema';
import * as _ from 'lodash';
import { ListingService } from '../../listing/listing.service'; // [NEW]

@Injectable()
export class MarketplaceService {
  private readonly logger = new Logger(MarketplaceService.name);

  constructor(
    private readonly registryService: MarketplaceRegistryService,
    private readonly authService: MarketplaceAuthService,
    private readonly listingService: ListingService, // [NEW]
  ) { }

  async findAll(): Promise<any[]> {
    return this.registryService.findAll();
  }

  async findOne(id: string): Promise<any> {
    return this.registryService.findOne(id);
  }

  async findByName(name: string): Promise<any> {
    return this.registryService.findByName(name);
  }

  async findByTag(tag: string): Promise<any> {
    return this.registryService.findByTag(tag);
  }

  async create(data: any): Promise<any> {
    return this.registryService.create(data);
  }

  async update(id: string, data: any): Promise<any> {
    return this.registryService.update(id, data);
  }

  async remove(id: string): Promise<void> {
    return this.registryService.remove(id);
  }

  async addRequirement(marketplaceId: string, data: any): Promise<any> {
    return this.registryService.addRequirement(marketplaceId, data);
  }

  async updateRequirement(marketplaceId: string, fieldName: string, data: any): Promise<any> {
    return this.registryService.updateRequirement(marketplaceId, fieldName, data);
  }

  async removeRequirement(marketplaceId: string, fieldName: string): Promise<void> {
    return this.registryService.removeRequirement(marketplaceId, fieldName);
  }

  async refreshToken(marketplaceId: string): Promise<MarketplaceToken> {
    return this.authService.ensureValidToken(marketplaceId);
  }


  async getRequirements(marketplaceId: string): Promise<any[]> {
    return this.registryService.getRequirements(marketplaceId);
  }

  async getEnabledMarketplaces(targetMarketplaceId?: string): Promise<any[]> {
    const marketplaces = await this.registryService.findAll();
    let enabledMarketplaces = marketplaces.filter(m => m.enabled);

    if (targetMarketplaceId) {
      enabledMarketplaces = enabledMarketplaces.filter(m => String(m._id) === String(targetMarketplaceId));
    }
    return enabledMarketplaces;
  }

  async checkProductRequirements(product: ProductDocument | ProductModel, marketplaceId: string): Promise<MarketplaceValidationResult> {
    const marketplace = await this.registryService.findOne(marketplaceId);
    if (!marketplace) {
      throw new Error(`Marketplace ${marketplaceId} não encontrado`);
    }

    const errors: ValidationError[] = [];
    const requirements = marketplace.requirements || [];

    // [REF] Fetch listings
    const prodId = (product as any)._id || (product as any).id;
    if (prodId) {
      const listings = await this.listingService.findByProduct(prodId);
      const hasTitleForMarketplace = listings.some((l: any) =>
        String(l.marketplaceId) === String(marketplace._id)
      );

      if (!hasTitleForMarketplace) {
        errors.push({
          field: 'titles',
          message: `É necessário definir um título específico para este marketplace (${marketplace.name}).`,
          code: 'REQUIRED_TITLE'
        });
      }
    }

    for (const req of requirements) {
      // 1. Determine the value from the Product
      // Use schemaField if available (mapping), otherwise fallback to fieldName (assuming direct match)
      const path = req.schemaField || req.fieldName;

      // Handle special cases or complex logic if needed, but 'lodash.get' handles dot notation nicely
      let value = _.get(product, path);

      this.logger.debug(`Checking requirement for ${marketplace.name}: Field=${req.fieldName}, Path=${path}, Value=${value}`);

      // 2. Check Required
      if (req.isRequired) {
        if (value === undefined || value === null || value === '') {
          this.logger.warn(`Requirement failed for ${marketplace.name}: ${req.fieldName} is missing. Path: ${path}, Value: ${value}`);
          errors.push({
            field: req.fieldName,
            message: `O campo obrigatório '${req.displayName || req.fieldName}' está ausente.`,
            code: 'REQUIRED'
          });
          continue; // Skip further checks for this field if missing
        }
      }

      // If optional and missing, okay
      if (value === undefined || value === null || value === '') {
        continue;
      }

      // 3. Type Validation
      if (req.dataType) {
        const type = typeof value;
        // Simple mapping
        if (req.dataType === 'string' && type !== 'string') {
          errors.push({ field: req.fieldName, message: `O campo '${req.displayName}' deve ser texto.`, code: 'INVALID_TYPE' });
        } else if (req.dataType === 'number' && type !== 'number' && isNaN(Number(value))) {
          errors.push({ field: req.fieldName, message: `O campo '${req.displayName}' deve ser numérico.`, code: 'INVALID_TYPE' });
        } else if (req.dataType === 'array' && !Array.isArray(value)) {
          errors.push({ field: req.fieldName, message: `O campo '${req.displayName}' deve ser uma lista.`, code: 'INVALID_TYPE' });
        } else if (req.dataType === 'boolean' && type !== 'boolean') {
          errors.push({ field: req.fieldName, message: `O campo '${req.displayName}' deve ser booleano.`, code: 'INVALID_TYPE' });
        }
      }

      // 4. Advanced/Rule Validation (from req.validationRules)
      if (req.validationRules) {
        // Min/Max Length (Strings)
        if (req.validationRules.minLength && String(value).length < req.validationRules.minLength) {
          errors.push({ field: req.fieldName, message: `O campo '${req.displayName}' deve ter no mínimo ${req.validationRules.minLength} caracteres.`, code: 'MIN_LENGTH' });
        }
        if (req.validationRules.maxLength && String(value).length > req.validationRules.maxLength) {
          errors.push({ field: req.fieldName, message: `O campo '${req.displayName}' deve ter no máximo ${req.validationRules.maxLength} caracteres.`, code: 'MAX_LENGTH' });
        }

        // Min/Max Value (Numbers)
        if (req.validationRules.min !== undefined && Number(value) < req.validationRules.min) {
          errors.push({ field: req.fieldName, message: `O campo '${req.displayName}' deve ser no mínimo ${req.validationRules.min}.`, code: 'MIN_VALUE' });
        }
        if (req.validationRules.max !== undefined && Number(value) > req.validationRules.max) {
          errors.push({ field: req.fieldName, message: `O campo '${req.displayName}' deve ser no máximo ${req.validationRules.max}.`, code: 'MAX_VALUE' });
        }

        // Regex Pattern
        if (req.validationRules.pattern) {
          try {
            const regex = new RegExp(req.validationRules.pattern);
            if (!regex.test(String(value))) {
              errors.push({ field: req.fieldName, message: `O campo '${req.displayName}' não segue o formato esperado.`, code: 'PATTERN_MISMATCH' });
            }
          } catch (e) {
            this.logger.warn(`Invalid regex pattern for field ${req.fieldName}: ${req.validationRules.pattern}`);
          }
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings: [],
    };
  }

  /**
   * Broadcast stock update to all enabled marketplaces.
   * Efficiently filters out marketplaces if excludeMarketplaceId is provided (e.g., origin of the change).
   */
  async updateStockInAllMarketplaces(productId: string, quantity: number, excludeMarketplaceId?: string): Promise<void> {
    const marketplaces = await this.getEnabledMarketplaces();

    this.logger.log(`[Broadcasting] Stock update for Product ${productId} -> Qty: ${quantity}. Targets: ${marketplaces.length} (Excluded: ${excludeMarketplaceId || 'None'})`);

    const promises = marketplaces.map(async (marketplace) => {
      // 1. Check Exclusion
      if (excludeMarketplaceId && String(marketplace.id) === String(excludeMarketplaceId)) {
        this.logger.debug(`[Skipping] Marketplace ${marketplace.name} is the origin.`);
        return;
      }

      // 2. Perform Update (Async/Fire-and-forget or awaited depending on reliability needs)
      try {
        this.logger.log(`[Simulating] Updating stock on ${marketplace.name} to ${quantity}`);
        // TODO: Call actual adapter updateStock method
      } catch (err) {
        this.logger.error(`Failed to update stock on ${marketplace.name}: ${err.message}`);
      }
    });

    await Promise.all(promises);
  }


}

