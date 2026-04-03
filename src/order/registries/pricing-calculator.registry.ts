import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { IPricingCalculatorStrategy } from '../strategies/pricing-calculator.strategy';

@Injectable()
export class PricingCalculatorRegistry implements OnModuleInit {
  private calculators = new Map<string, IPricingCalculatorStrategy>();
  private logger = new Logger(PricingCalculatorRegistry.name);

  constructor(
    @Inject('PRICING_STRATEGIES') private strategies: IPricingCalculatorStrategy[] = []
  ) {}

  onModuleInit(): void {
    // Auto-registrar estratégias injetadas
    this.logger.log(`[PricingCalculatorRegistry] Initializing with ${this.strategies.length} strategies`);
    for (const strategy of this.strategies) {
      if (strategy && strategy.getName) {
        this.register(strategy.getName(), strategy);
      }
    }
    this.logger.log(`[PricingCalculatorRegistry] Initialized calculators: ${Array.from(this.calculators.keys()).join(', ')}`);
  }

  /**
   * Normaliza nome do marketplace (remove espaços, acentos, etc)
   */
  private normalize(marketplace: string): string {
    return marketplace
      .toUpperCase()
      .replace(/\s+/g, '') // Remove espaços
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, ''); // Remove acentos
  }

  /**
   * Registra uma estratégia de calculadora de preço
   */
  register(marketplace: string, calculator: IPricingCalculatorStrategy): void {
    const key = this.normalize(marketplace);
    this.calculators.set(key, calculator);
    this.logger.log(`Registered pricing calculator for marketplace: ${key}`);
  }

  /**
   * Obtém a calculadora para um marketplace
   * Se não encontrar, retorna null
   */
  get(marketplace: string): IPricingCalculatorStrategy | null {
    const key = this.normalize(marketplace);
    const calculator = this.calculators.get(key);

    if (!calculator) {
      this.logger.warn(
        `No pricing calculator found for marketplace: ${marketplace} (normalized: ${key}). Available: ${Array.from(this.calculators.keys()).join(', ')}`
      );
    }

    return calculator || null;
  }

  /**
   * Lista todas as calculadoras registradas
   */
  list(): string[] {
    return Array.from(this.calculators.keys());
  }

  /**
   * Verifica se uma calculadora está registrada
   */
  has(marketplace: string): boolean {
    return this.calculators.has(marketplace.toUpperCase());
  }
}
