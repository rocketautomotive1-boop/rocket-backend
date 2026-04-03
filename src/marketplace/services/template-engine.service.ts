import { Injectable, Logger } from '@nestjs/common';
import { TemplateConditionEvaluator } from './template-condition.evaluator';

interface TemplateSection {
  condition: string;
  content: string;
}

/**
 * Responsabilidade única: dado um template string + dados, produzir a descrição final.
 *
 * Fluxo garantido (nunca mude a ordem):
 *   1. processSections()     — avalia condições e remove/mantém blocos [SECTION]
 *   2. replacePlaceholders() — substitui {placeholder} pelos valores
 *   3. cleanup()             — remove linhas extras e espaços desnecessários
 *
 * Este serviço NÃO acessa banco de dados e NÃO conhece o produto diretamente.
 * Recebe apenas strings e mapas — testável com dados puros.
 *
 * Para corrigir problema de formatação → edite cleanup()
 * Para corrigir processamento de seções → edite processSections()
 * Para corrigir substituição de campos → edite replacePlaceholders()
 */
@Injectable()
export class TemplateEngine {
  private readonly logger = new Logger(TemplateEngine.name);

  constructor(private readonly evaluator: TemplateConditionEvaluator) {}

  /**
   * Processa um template completo.
   *
   * @param templateText     Texto do template com placeholders e seções
   * @param sections         Array de seções condicionais do template
   * @param fieldMap         Mapa placeholder → valor (do ProductFieldMapper)
   * @param conditionContext Objeto bruto para avaliação de condições (produto)
   */
  process(
    templateText: string,
    sections: TemplateSection[],
    fieldMap: Record<string, string>,
    conditionContext: Record<string, any>,
  ): string {
    if (!templateText?.trim()) {
      this.logger.warn('Template vazio recebido. Retornando string vazia.');
      return '';
    }

    let text = templateText;
    text = this.processSections(text, sections, conditionContext); // Passo 1
    text = this.replacePlaceholders(text, fieldMap);               // Passo 2
    text = this.cleanup(text);                                      // Passo 3
    return text;
  }

  // ── Passo 1: Seções condicionais ──────────────────────────────────────────

  /**
   * DEVE ser executado ANTES de replacePlaceholders.
   *
   * Percorre as seções do template. Para cada seção:
   * - Condição TRUE  → remove as tags [NOME_SECTION] e [/NOME_SECTION], mantém conteúdo
   * - Condição FALSE → remove o bloco inteiro (tags + conteúdo, incluindo placeholders)
   *
   * Isso garante que {observacao} dentro de [AVARIADO_SECTION] seja removido
   * junto com a seção quando a condição não for atendida.
   */
  private processSections(
    text: string,
    sections: TemplateSection[],
    ctx: Record<string, any>,
  ): string {
    if (!sections?.length) return text;

    for (const section of sections) {
      if (!section.condition || !section.content) continue;

      try {
        const conditionMet = this.evaluator.evaluate(section.condition, ctx);
        this.logger.debug(`Seção condição "${section.condition}": ${conditionMet}`);

        if (conditionMet) {
          // Mantém conteúdo, remove apenas as tags
          const contentWithoutTags = section.content
            .replace(/\[[A-Z_]+_SECTION\]\s*/g, '')
            .replace(/\[\/[A-Z_]+_SECTION\]\s*/g, '');

          if (text.includes(section.content)) {
            text = text.replace(section.content, contentWithoutTags);
          }
          // Se o conteúdo não foi encontrado exato, as tags serão limpas no passo final
        } else {
          // Remove bloco inteiro (conteúdo + tags)
          if (text.includes(section.content)) {
            text = text.replace(section.content, '');
          } else {
            // Fallback: remove pelo nome da tag via regex
            const tagMatch = section.content.match(/^\[([A-Z_]+_SECTION)\]/);
            if (tagMatch) {
              const tagName = tagMatch[1];
              const tagRegex = new RegExp(`\\[${tagName}\\][\\s\\S]*?\\[\\/${tagName}\\]`, 'g');
              text = text.replace(tagRegex, '');
            }
          }
        }
      } catch (err) {
        this.logger.error(`Erro ao processar seção "${section.condition}": ${err.message}`);
      }
    }

    // Remove tags soltas remanescentes
    text = text
      .replace(/\[[A-Z_]+_SECTION\]/g, '')
      .replace(/\[\/[A-Z_]+_SECTION\]/g, '');

    return text;
  }

  // ── Passo 2: Substituição de placeholders ─────────────────────────────────

  /**
   * Substitui todos os {placeholder} pelos valores do fieldMap.
   * Placeholders não encontrados no mapa são removidos (substituídos por '').
   */
  private replacePlaceholders(text: string, fieldMap: Record<string, string>): string {
    return text.replace(/\{(\w+)\}/g, (match, key) => {
      return Object.prototype.hasOwnProperty.call(fieldMap, key)
        ? (fieldMap[key] ?? '')
        : '';
    });
  }

  // ── Passo 3: Limpeza ───────────────────────────────────────────────────────

  /**
   * Remove linhas que ficaram só com espaços/tabs após substituição,
   * colapsa 3+ quebras de linha consecutivas para no máximo 2,
   * e remove espaços nas bordas do resultado.
   */
  private cleanup(text: string): string {
    return text
      .replace(/^[ \t]+$/gm, '')  // linhas só com espaços/tabs → vazia
      .replace(/\n{3,}/g, '\n\n') // 3+ quebras de linha → 2 (máx 1 linha em branco)
      .trim();
  }
}
