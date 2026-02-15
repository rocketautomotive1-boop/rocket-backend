# OLX - Integração com Templates de Descrição

## Visão Geral

A integração com a OLX agora utiliza o sistema de templates de descrição para gerar descrições padronizadas e profissionais para os anúncios. Isso garante consistência na comunicação e melhora a qualidade das descrições dos produtos.

## Funcionalidades Implementadas

### ✅ **Templates de Descrição**
- ✅ Template padrão específico para OLX
- ✅ Geração automática de descrições
- ✅ Fallback para descrição padrão se template falhar
- ✅ Suporte a variáveis dinâmicas
- ✅ Seções condicionais baseadas no produto

### ✅ **Endpoints de Gerenciamento**
- ✅ `GET /marketplace/olx/templates` - Listar templates
- ✅ `GET /marketplace/olx/templates/default` - Obter template padrão
- ✅ `POST /marketplace/olx/templates` - Criar novo template
- ✅ `PUT /marketplace/olx/templates/:id` - Atualizar template
- ✅ `DELETE /marketplace/olx/templates/:id` - Excluir template
- ✅ `POST /marketplace/olx/templates/generate` - Gerar descrição

## Template Padrão da OLX

### **Estrutura do Template**
```markdown
🚗 {produto}

📋 INFORMAÇÕES DO PRODUTO:
• Marca: {marca}
• Modelo: {modelo}
• Código: {codigo}
• Condição: Novo

📝 DESCRIÇÃO:
{descricao_curta}

📏 ESPECIFICAÇÕES:
• Peso: {peso}kg
• Dimensões: {comprimento}cm x {largura}cm x {altura}cm

🔧 COMPATIBILIDADE:
Compatível com veículos que utilizam {modelo}

💰 PREÇO:
R$ {preco}

📦 ENVIO:
• Envio para todo o Brasil
• Rastreamento incluído
• Prazo de entrega: 3-7 dias úteis

💳 FORMAS DE PAGAMENTO:
• PIX
• Cartão de crédito
• Boleto bancário
• Transferência bancária

🛡️ GARANTIA:
{garantia}

📞 ATENDIMENTO:
• WhatsApp: (81) 99651-8865
• Horário: Segunda a Sexta, 8h às 18h

⚠️ IMPORTANTE:
• Produto novo e original
• Verifique a compatibilidade antes da compra
• Entre em contato para esclarecimentos

🏪 SOBRE NÓS:
Somos especialistas em peças automotivas com anos de experiência no mercado. Todos os nossos produtos são originais e possuem garantia de fábrica.
```

### **Variáveis Disponíveis**
- `{produto}` - Nome do produto formatado
- `{marca}` - Marca do produto
- `{modelo}` - Modelo/partNumber do produto
- `{codigo}` - Código GTIN ou partNumber
- `{descricao_curta}` - Descrição curta do produto
- `{preco}` - Preço formatado
- `{peso}` - Peso em kg
- `{comprimento}` - Comprimento em cm
- `{largura}` - Largura em cm
- `{altura}` - Altura em cm
- `{garantia}` - Descrição da garantia

### **Seções Condicionais**
```json
[
  {
    "condition": "price > 1000",
    "content": "💎 PRODUTO PREMIUM 💎\nEste é um produto de alta qualidade com garantia estendida e suporte técnico especializado."
  },
  {
    "condition": "price < 100",
    "content": "🔥 SUPER PROMOÇÃO 🔥\nAproveite este preço especial por tempo limitado!"
  },
  {
    "condition": "weight > 10",
    "content": "📦 FRETE GRÁTIS 📦\nFrete grátis para todo o Brasil!"
  }
]
```

## Como Funciona

### **1. Importação de Anúncios**
Quando um anúncio é importado para a OLX:

1. **Busca do Template:** O sistema busca o template padrão da OLX
2. **Geração da Descrição:** Substitui as variáveis pelos dados do produto
3. **Aplicação de Seções Condicionais:** Inclui seções baseadas no preço, peso, etc.
4. **Fallback:** Se o template falhar, usa descrição padrão simples

### **2. Exemplo de Uso**
```typescript
// No OLXImportService
const description = await this.descriptionService.generateDescription(product, 'OLX');

return {
  id: product.id,
  operation: 'insert',
  category: 2101,
  Subject: product.productTitles?.[0]?.title || product.name,
  Body: description, // Descrição gerada pelo template
  // ... outros campos
};
```

## Endpoints de Gerenciamento

### **Listar Templates**
```bash
GET /marketplace/olx/templates
```

**Resposta:**
```json
[
  {
    "id": 1,
    "name": "Template Padrão OLX",
    "title": "{produto} - {marca} {modelo} | Peças Automotivas",
    "template": "...",
    "isDefault": true,
    "isActive": true
  }
]
```

### **Obter Template Padrão**
```bash
GET /marketplace/olx/templates/default
```

### **Criar Novo Template**
```bash
POST /marketplace/olx/templates
Content-Type: application/json

{
  "name": "Template Premium OLX",
  "title": "{produto} Premium - {marca}",
  "template": "🚗 {produto} Premium\n\n...",
  "isDefault": false,
  "placeholders": {
    "garantia": "24 meses de garantia"
  },
  "sections": [
    {
      "condition": "price > 2000",
      "content": "💎 PRODUTO EXCLUSIVO 💎"
    }
  ]
}
```

### **Atualizar Template**
```bash
PUT /marketplace/olx/templates/1
Content-Type: application/json

{
  "name": "Template Atualizado",
  "template": "Nova descrição..."
}
```

### **Excluir Template**
```bash
DELETE /marketplace/olx/templates/1
```

### **Gerar Descrição**
```bash
POST /marketplace/olx/templates/generate
Content-Type: application/json

{
  "product": {
    "name": "Paralama Dianteiro",
    "brand": { "name": "Toyota" },
    "partNumber": "12345",
    "shortDescription": "Paralama original Toyota",
    "price": 150.00,
    "weight": 2.5
  },
  "templateId": 1
}
```

## Migração Criada

### **Arquivo:** `1716938100000-CreateOLXMarketplaceAndTemplate.ts`

**O que faz:**
1. **Insere marketplace OLX** na tabela `marketplaces`
2. **Cria template padrão** na tabela `marketplace_description_templates`
3. **Configura seções condicionais** baseadas no preço e peso
4. **Define placeholders** para garantia

**Dados inseridos:**
- **Marketplace:** OLX com appId `c827ec4862c2c5e5873c82a36baacf024e9d03ab`
- **Template:** Template completo com emojis e formatação profissional
- **Seções:** Condicionais para produtos premium, promoções e frete grátis

## Vantagens da Implementação

### **✅ Consistência**
- Todas as descrições seguem o mesmo padrão
- Informações organizadas e profissionais
- Formatação padronizada com emojis

### **✅ Flexibilidade**
- Templates personalizáveis
- Seções condicionais dinâmicas
- Suporte a múltiplos templates

### **✅ Manutenibilidade**
- Fácil atualização de templates
- Centralização da lógica de descrição
- Reutilização em outros marketplaces

### **✅ Qualidade**
- Descrições mais atrativas
- Informações completas e organizadas
- Melhor conversão de vendas

## Próximos Passos

1. **✅ Implementação básica** - Concluída
2. **🔄 Testes de integração** - Em andamento
3. **📝 Documentação de uso** - Concluída
4. **🔧 Otimizações de performance** - Pendente
5. **🎨 Templates adicionais** - Pendente

## Exemplo de Resultado

### **Produto Original:**
```json
{
  "name": "Paralama Dianteiro Toyota Corolla",
  "brand": { "name": "Toyota" },
  "partNumber": "12345",
  "shortDescription": "Paralama original Toyota Corolla 2020-2023",
  "price": 150.00,
  "weight": 2.5
}
```

### **Descrição Gerada:**
```
🚗 Paralama Dianteiro Toyota Corolla 12345

📋 INFORMAÇÕES DO PRODUTO:
• Marca: Toyota
• Modelo: 12345
• Código: 12345
• Condição: Novo

📝 DESCRIÇÃO:
Paralama original Toyota Corolla 2020-2023

📏 ESPECIFICAÇÕES:
• Peso: 2.5kg
• Dimensões: 0cm x 0cm x 0cm

🔧 COMPATIBILIDADE:
Compatível com veículos que utilizam 12345

💰 PREÇO:
R$ 150.00

📦 ENVIO:
• Envio para todo o Brasil
• Rastreamento incluído
• Prazo de entrega: 3-7 dias úteis

💳 FORMAS DE PAGAMENTO:
• PIX
• Cartão de crédito
• Boleto bancário
• Transferência bancária

🛡️ GARANTIA:
12 meses de garantia de fábrica

📞 ATENDIMENTO:
• WhatsApp: (81) 99651-8865
• Horário: Segunda a Sexta, 8h às 18h

⚠️ IMPORTANTE:
• Produto novo e original
• Verifique a compatibilidade antes da compra
• Entre em contato para esclarecimentos

🏪 SOBRE NÓS:
Somos especialistas em peças automotivas com anos de experiência no mercado. Todos os nossos produtos são originais e possuem garantia de fábrica.
```

## Conclusão

A integração com templates de descrição da OLX representa um avanço significativo na qualidade e consistência das descrições dos produtos. O sistema agora gera automaticamente descrições profissionais e atrativas, melhorando a experiência do comprador e aumentando as chances de conversão. 