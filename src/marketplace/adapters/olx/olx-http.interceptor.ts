import { Injectable, Logger } from '@nestjs/common';
import { NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { OLXAuthService } from './olx-auth.service';

@Injectable()
export class OLXHttpInterceptor implements NestInterceptor {
  private readonly logger = new Logger(OLXHttpInterceptor.name);
  private readonly olxDomains = ['auth.olx.com.br', 'apps.olx.com.br'];

  constructor(private readonly olxAuthService: OLXAuthService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest();
    const url = request.url;

    // Verificar se a requisição é para a API da OLX
    if (this.isOLXRequest(url)) {
      return this.handleOLXRequest(context, next);
    }

    // Para outras requisições, apenas passar adiante
    return next.handle();
  }

  /**
   * Verificar se a requisição é para a API da OLX
   * @param url - URL da requisição
   */
  private isOLXRequest(url: string): boolean {
    try {
      const urlObj = new URL(url);
      return this.olxDomains.some(domain => urlObj.hostname.includes(domain));
    } catch (error) {
      return false;
    }
  }

  /**
   * Manipular requisições para a API da OLX
   * @param context - Contexto da execução
   * @param next - Próximo handler
   */
  private async handleOLXRequest(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    try {
      // Obter token válido automaticamente
      const accessToken = await this.olxAuthService.getValidToken('OLX');

      // Adicionar header de autorização
      const request = context.switchToHttp().getRequest();
      request.headers['Authorization'] = `Bearer ${accessToken}`;

      this.logger.debug(`Adicionando token de autorização para requisição OLX: ${request.url}`);
      return next.handle();
    } catch (error) {
      this.logger.error(`Erro ao obter token para requisição OLX: ${error.message}`);
      
      // Se não conseguir obter token, tentar requisição sem autorização
      // (pode ser uma requisição de autenticação)
      const request = context.switchToHttp().getRequest();
      if (request.url.includes('/oauth/token')) {
        this.logger.debug(`Requisição de autenticação OLX - não adicionando token`);
        return next.handle();
      }

      // Para outras requisições, lançar erro
      throw new Error(`Falha ao obter token de autorização para OLX: ${error.message}`);
    }
  }
} 