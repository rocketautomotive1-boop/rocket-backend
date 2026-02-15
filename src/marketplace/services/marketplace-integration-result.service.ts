import { Injectable, Logger } from '@nestjs/common';
import { MarketplaceDocument } from '../schemas/marketplace.schema';

@Injectable()
export class MarketplaceIntegrationResultService {
  private readonly logger = new Logger(MarketplaceIntegrationResultService.name);

  /**
   * Consolida os resultados de um marketplace específico
   */
  consolidateMarketplaceResults(marketplace: MarketplaceDocument, marketplaceResults: any[]) {
    // Se não houver resultados, considerar como falha
    if (marketplaceResults.length === 0) {
      return {
        marketplaceId: marketplace._id,
        marketplaceName: marketplace.name,
        success: false,
        error: `Nenhum título processado para o marketplace ${marketplace.name}`,
        titleResults: []
      };
    }

    const allSuccess = marketplaceResults.every(r => r.success);
    const anySuccess = marketplaceResults.some(r => r.success);

    if (allSuccess) {
      return {
        marketplaceId: marketplace._id,
        marketplaceName: marketplace.name,
        success: true,
        message: `Todos os ${marketplaceResults.length} títulos integrados com sucesso`,
        titleResults: marketplaceResults
      };
    } else if (anySuccess) {
      return {
        marketplaceId: marketplace._id,
        marketplaceName: marketplace.name,
        success: true,
        message: `${marketplaceResults.filter(r => r.success).length} de ${marketplaceResults.length} títulos integrados com sucesso`,
        titleResults: marketplaceResults
      };
    } else {
      return {
        marketplaceId: marketplace._id,
        marketplaceName: marketplace.name,
        success: false,
        error: `Falha na integração de todos os títulos`,
        titleResults: marketplaceResults
      };
    }
  }

  /**
   * Cria um resultado de erro para um marketplace
   */
  createErrorResult(marketplace: MarketplaceDocument, error: any) {
    return {
      marketplaceId: marketplace._id,
      marketplaceName: marketplace.name,
      success: false,
      error: `Erro ao processar marketplace: ${error.message}`,
      response: {
        status: 500,
        message: error.message,
        timestamp: new Date().toISOString()
      }
    };
  }

  /**
   * Consolida todos os resultados de integração
   */
  consolidateResults(results: any[]) {
    // Verificar resultados
    const allSuccess = results.every(r => r.success);
    const anySuccess = results.some(r => r.success);

    if (allSuccess) {
      return {
        success: true,
        message: `Produto integrado com sucesso em todos os ${results.length} marketplaces`,
        marketplaceResults: results,
        response: {
          status: 200,
          marketplaces: results.length,
          timestamp: new Date().toISOString()
        }
      };
    } else if (anySuccess) {
      return {
        success: true,
        message: `Produto integrado parcialmente: ${results.filter(r => r.success).length} de ${results.length} marketplaces`,
        marketplaceResults: results,
        response: {
          status: 207,
          marketplaces: results.length,
          successCount: results.filter(r => r.success).length,
          timestamp: new Date().toISOString()
        }
      };
    } else {
      return {
        success: false,
        error: 'Falha na integração com todos os marketplaces',
        marketplaceResults: results,
        response: {
          status: 500,
          marketplaces: results.length,
          errors: results.map(r => ({ marketplace: r.marketplaceName, error: r.error })),
          timestamp: new Date().toISOString()
        }
      };
    }
  }
}
