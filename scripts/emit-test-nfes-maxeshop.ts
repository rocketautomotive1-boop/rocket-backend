// backend/scripts/emit-test-nfes-maxeshop.ts
/**
 * Dispara 15 NFe-e avulsas em homologação via POST /fiscal/nfe/avulsa,
 * remetente MAX ESHOP LTDA, destinatário fixo, um item de autopeça
 * diferente por nota. Requer o backend rodando em localhost:3000 e o
 * emitente já semeado (scripts/seed-fiscal-issuer-maxeshop.ts).
 *
 * Run: npx ts-node -r tsconfig-paths/register scripts/emit-test-nfes-maxeshop.ts
 */

const API_BASE = 'http://localhost:3000';

const BUYER = {
  document: '06726952430',
  name: 'Gustavo Henrique Ferreira Santos',
  address: {
    street: 'Rua Jose Braz Moscow',
    number: '678',
    neighborhood: 'Piedade',
    city: 'Jaboatao dos Guararapes',
    state: 'PE',
    zipCode: '54410390',
  },
};

const TEST_ITEMS: Array<{ title: string; unit_price: number }> = [
  { title: 'Amortecedor Dianteiro Teste 01', unit_price: 180.5 },
  { title: 'Pastilha de Freio Dianteira Teste 02', unit_price: 89.9 },
  { title: 'Filtro de Oleo Teste 03', unit_price: 32.0 },
  { title: 'Correia Dentada Teste 04', unit_price: 145.0 },
  { title: 'Kit Embreagem Teste 05', unit_price: 299.9 },
  { title: 'Vela de Ignicao Teste 06', unit_price: 45.0 },
  { title: 'Bateria Automotiva Teste 07', unit_price: 280.0 },
  { title: 'Radiador Teste 08', unit_price: 210.0 },
  { title: 'Amortecedor Traseiro Teste 09', unit_price: 175.0 },
  { title: 'Disco de Freio Teste 10', unit_price: 120.0 },
  { title: 'Sensor de Oxigenio Teste 11', unit_price: 95.0 },
  { title: 'Bomba de Combustivel Teste 12', unit_price: 260.0 },
  { title: 'Alternador Teste 13', unit_price: 320.0 },
  { title: 'Cabo de Vela Teste 14', unit_price: 55.0 },
  { title: 'Junta do Cabecote Teste 15', unit_price: 130.0 },
];

function buildPayload(item: { title: string; unit_price: number }, index: number) {
  return {
    environment: 'HOMOLOGATION',
    buyer: BUYER,
    items: [
      {
        id: `teste-${index + 1}`,
        title: item.title,
        quantity: 1,
        unit_price: item.unit_price,
        ncm: '87089990',
        cfop: '5102',
        uCom: 'UN',
      },
    ],
    totals: { amount: item.unit_price },
  };
}

async function emitOne(payload: any): Promise<any> {
  const res = await fetch(`${API_BASE}/fiscal/nfe/avulsa`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { status: 'HTTP_ERROR', httpStatus: res.status, message: (body as any)?.message ?? JSON.stringify(body) };
  }
  return body;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const results: Array<{ title: string; status: string; accessKey?: string; message?: string }> = [];

  for (let i = 0; i < TEST_ITEMS.length; i++) {
    const item = TEST_ITEMS[i];
    const payload = buildPayload(item, i);
    console.log(`[${i + 1}/15] Emitindo: ${item.title} (R$${item.unit_price})...`);

    try {
      const result = await emitOne(payload);
      results.push({
        title: item.title,
        status: result.status ?? 'UNKNOWN',
        accessKey: result.accessKey,
        message: result.rejectionReason ?? result.message,
      });
      console.log(`  → status=${result.status} accessKey=${result.accessKey ?? '-'} ${result.rejectionReason ?? ''}`);
    } catch (err: any) {
      results.push({ title: item.title, status: 'SCRIPT_ERROR', message: err?.message });
      console.error(`  → ERRO: ${err?.message}`);
    }

    if (i < TEST_ITEMS.length - 1) {
      await sleep(2000);
    }
  }

  const authorized = results.filter((r) => r.status === 'AUTHORIZED').length;
  const errored = results.filter((r) => r.status !== 'AUTHORIZED').length;

  console.log('\n=== Resumo ===');
  console.log(`Autorizadas: ${authorized}`);
  console.log(`Com erro/rejeitadas: ${errored}`);
  results.forEach((r, i) => {
    if (r.status !== 'AUTHORIZED') {
      console.log(`  [${i + 1}] ${r.title}: ${r.status} — ${r.message ?? ''}`);
    }
  });
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Emissao de notas de teste FAILED:', err?.message);
    console.error(err?.stack);
    process.exit(1);
  });
}
