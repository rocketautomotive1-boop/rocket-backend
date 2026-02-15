
import mongoose from 'mongoose';
import * as fs from 'fs';
import * as path from 'path';

async function cleanup() {
    console.log('Iniciando limpeza de Legacy "titles" em Products...');

    // 1. Load Environment Variables manually
    const envPath = path.resolve(__dirname, '..', '.env');
    let mongoUri = process.env.MONGO_URI;

    if (fs.existsSync(envPath)) {
        const envConfig = fs.readFileSync(envPath).toString();
        // Parse .env considering quotes and comments
        const lines = envConfig.split('\n');
        const uriLine = lines.find(line => line.trim().startsWith('MONGO_URI='));
        if (uriLine) {
            const parts = uriLine.split('=');
            let uriValue = parts.slice(1).join('=').trim();

            if (uriValue.includes(' #')) {
                uriValue = uriValue.split(' #')[0].trim();
            } else if (uriValue.endsWith('#')) {
                const commentIndex = uriValue.indexOf(' #');
                if (commentIndex !== -1) {
                    uriValue = uriValue.substring(0, commentIndex).trim();
                }
            }

            if ((uriValue.startsWith('"') && uriValue.endsWith('"')) || (uriValue.startsWith("'") && uriValue.endsWith("'"))) {
                uriValue = uriValue.slice(1, -1);
            }
            mongoUri = uriValue;
        }
    }

    if (!mongoUri) {
        console.error('MONGO_URI não encontrado.');
        process.exit(1);
    }

    // 2. Connect
    const maskedUri = mongoUri.replace(/:([^:@]+)@/, ':****@');
    console.log(`Conectando ao MongoDB... (URI: ${maskedUri})`);

    try {
        await mongoose.connect(mongoUri);
        console.log('Conectado.');
    } catch (err) {
        console.error('Erro de conexão:', err.message);
        process.exit(1);
    }

    // 3. Cleanup
    try {
        const Product = mongoose.connection.collection('products');

        console.log('Removendo campo "titles" de todos os produtos...');
        const result = await Product.updateMany({}, { $unset: { titles: "" } });

        console.log(`Limpeza concluída.`);
        console.log(`Documentos modificados: ${result.modifiedCount}`);
        console.log(`Documentos encontrados: ${result.matchedCount}`);

    } catch (err) {
        console.error('Erro durante a limpeza:', err);
    } finally {
        await mongoose.disconnect();
        console.log('Desconectado.');
    }
}

cleanup().catch(console.error);
