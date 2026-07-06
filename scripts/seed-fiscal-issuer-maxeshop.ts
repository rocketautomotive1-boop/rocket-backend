// backend/scripts/seed-fiscal-issuer-maxeshop.ts
/**
 * Seed one-off do emitente fiscal MAX ESHOP LTDA para testes de emissão de
 * NFe em homologação. Lê o certificado .pfx do disco, converte para base64
 * e faz upsert em fiscal_issuers com isActive:true.
 *
 * Usa MongoClient direto (sem subir o AppModule). Requer MONGO_URI no .env.
 * Run: npx ts-node -r tsconfig-paths/register scripts/seed-fiscal-issuer-maxeshop.ts
 */
import 'dotenv/config';
import * as fs from 'fs';
import { MongoClient } from 'mongodb';

const CERT_PATH = 'C:\\Users\\gusta\\Downloads\\MAXESHOP.pfx';
const CERT_PASSWORD = 'Max160387@';

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI ausente no .env');

  if (!fs.existsSync(CERT_PATH)) {
    throw new Error(`Certificado não encontrado em ${CERT_PATH}`);
  }
  const certificatePfx = fs.readFileSync(CERT_PATH).toString('base64');

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db();
    const issuers = db.collection('fiscal_issuers');

    const result = await issuers.findOneAndUpdate(
      { isActive: true },
      {
        $set: {
          cnpj: '67278239000107',
          ie: '134858140',
          companyName: 'MAX ESHOP LTDA',
          fantasyName: 'MAX ESHOP',
          taxRegime: 'SIMPLES_NACIONAL',
          nfeSeries: 1,
          certificatePfx,
          certificatePassword: CERT_PASSWORD,
          address: {
            street: 'RUA CARLOS GOMES',
            number: '395',
            neighborhood: 'MADALENA',
            city: 'RECIFE',
            state: 'PE',
            zipCode: '50720135',
            ibgeCode: '2611606',
          },
          isActive: true,
        },
        $setOnInsert: {
          seriesCounters: {},
        },
      },
      { upsert: true, returnDocument: 'after' },
    );

    console.log('Emitente MAX ESHOP salvo:', {
      _id: (result as any)?._id ?? (result as any)?.value?._id,
      cnpj: (result as any)?.cnpj ?? (result as any)?.value?.cnpj,
      isActive: (result as any)?.isActive ?? (result as any)?.value?.isActive,
    });
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Seed do emitente MAX ESHOP FAILED:', err?.message);
    console.error(err?.stack);
    process.exit(1);
  });
}
