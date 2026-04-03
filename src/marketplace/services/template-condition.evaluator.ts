import { Injectable } from '@nestjs/common';

/**
 * Responsabilidade única: avaliar condições de seções condicionais de templates.
 *
 * Suporta: >, <, ==, !=
 * Suporte especial para != '' (campo não-vazio).
 *
 * Exemplo de condições:
 *   "isGenuine == 1"
 *   "details != ''"
 *   "price > 500"
 *   "condition == damaged"
 */
@Injectable()
export class TemplateConditionEvaluator {
  /**
   * Avalia uma condição contra um contexto (produto ou mapa flat).
   * @param condition  string de condição, ex: "isGenuine == 1"
   * @param context    objeto do produto ou mapa flat de valores
   */
  evaluate(condition: string, context: Record<string, any>): boolean {
    if (!condition?.trim()) return true;

    try {
      if (condition.includes('!=')) return this.evaluateNotEqual(condition, context);
      if (condition.includes('>=')) return this.evaluateGte(condition, context);
      if (condition.includes('<=')) return this.evaluateLte(condition, context);
      if (condition.includes('>'))  return this.evaluateGt(condition, context);
      if (condition.includes('<'))  return this.evaluateLt(condition, context);
      if (condition.includes('==')) return this.evaluateEqual(condition, context);
    } catch {
      return false;
    }

    return false;
  }

  // ── Operadores ─────────────────────────────────────────────────────────────

  private evaluateEqual(condition: string, ctx: Record<string, any>): boolean {
    const [field, rawValue] = condition.split('==').map(s => s.trim());
    const value = this.getValue(field, ctx);
    const cleanValue = rawValue.replace(/^['"](.*)['"]$/, '$1');

    const numRaw = Number(rawValue);
    const numVal = Number(value);
    if (!isNaN(numRaw) && !isNaN(numVal)) return numVal === numRaw;

    return String(value) === cleanValue;
  }

  private evaluateNotEqual(condition: string, ctx: Record<string, any>): boolean {
    const [field, rawValue] = condition.split('!=').map(s => s.trim());
    const value = this.getValue(field, ctx);
    const cleanValue = rawValue.replace(/^['"](.*)['"]$/, '$1');

    // != null → campo existe e não é nulo/undefined
    if (rawValue === 'null') return value !== null && value !== undefined;

    // != '' → campo existe, não é nulo e não é string vazia
    if (cleanValue === '') {
      return value !== null && value !== undefined && String(value).trim() !== '';
    }

    return String(value) !== cleanValue;
  }

  private evaluateGt(condition: string, ctx: Record<string, any>): boolean {
    const [field, rawValue] = condition.split('>').map(s => s.trim());
    return Number(this.getValue(field, ctx)) > Number(rawValue);
  }

  private evaluateLt(condition: string, ctx: Record<string, any>): boolean {
    const [field, rawValue] = condition.split('<').map(s => s.trim());
    return Number(this.getValue(field, ctx)) < Number(rawValue);
  }

  private evaluateGte(condition: string, ctx: Record<string, any>): boolean {
    const [field, rawValue] = condition.split('>=').map(s => s.trim());
    return Number(this.getValue(field, ctx)) >= Number(rawValue);
  }

  private evaluateLte(condition: string, ctx: Record<string, any>): boolean {
    const [field, rawValue] = condition.split('<=').map(s => s.trim());
    return Number(this.getValue(field, ctx)) <= Number(rawValue);
  }

  // ── Acesso a campos (dot-notation) ─────────────────────────────────────────

  private getValue(field: string, ctx: Record<string, any>): any {
    return field.split('.').reduce((obj, key) => {
      if (obj === null || obj === undefined) return null;
      return obj[key];
    }, ctx as any);
  }
}
