
import { ProductModel, ProductSchema } from '../src/product/schemas/product.schema';
import { ListingModel, ListingSchema } from '../src/listing/schemas/listing.schema';
import mongoose from 'mongoose';
import * as fs from 'fs';
import * as path from 'path';

// Standalone script to avoid NestJS bootstrapping issues with absolute paths
async function bootstrap() {
    console.log('Iniciando migração de Product Titles para Listings (Standalone Mode)...');

    // 1. Load Environment Variables manually
    const envPath = path.resolve(__dirname, '..', '.env');
    let mongoUri = process.env.MONGO_URI;

    if (fs.existsSync(envPath)) {
        const envConfig = fs.readFileSync(envPath).toString();
        // Improved parsing to handle quotes and comments
        const lines = envConfig.split('\n');
        const uriLine = lines.find(line => line.trim().startsWith('MONGO_URI='));
        if (uriLine) {
            // Split only on the first '=' to handle values containing '='
            const parts = uriLine.split('=');
            let uriValue = parts.slice(1).join('=').trim();

            // Remove comments (starting with #)
            if (uriValue.includes(' #')) { // Space before # to avoid matching inside string if possible, though # is rare in URI
                uriValue = uriValue.split(' #')[0].trim();
            } else if (uriValue.endsWith('#')) { // unlikely but possible comment start
                // Basic comment handling for simple .env files
                const commentIndex = uriValue.indexOf(' #');
                if (commentIndex !== -1) {
                    uriValue = uriValue.substring(0, commentIndex).trim();
                }
            }

            // Remove quotes
            if ((uriValue.startsWith('"') && uriValue.endsWith('"')) || (uriValue.startsWith("'") && uriValue.endsWith("'"))) {
                uriValue = uriValue.slice(1, -1);
            }
            mongoUri = uriValue;
        }
    }

    if (!mongoUri) {
        console.error('MONGO_URI não encontrado no .env ou variáveis de ambiente.');
        process.exit(1);
    }

    // 2. Connect to MongoDB
    // Mask URI for logging
    const maskedUri = mongoUri ? mongoUri.replace(/:([^:@]+)@/, ':****@') : 'undefined';
    console.log(`Conectando ao MongoDB... (URI: ${maskedUri})`);

    try {
        await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 }); // Fail faster if network issue
    } catch (connErr) {
        console.error('Falha na conexão com MongoDB:', connErr.message);
        console.error('Verifique se o IP está liberado no Atlas ou se a URI está correta.');
        process.exit(1);
    }

    // 3. Register Models
    // Using names strictly as defined in schemas if they use @Schema decorator
    // ProductSchema usually defines collection 'products'. ListingSchema 'listings'.
    const ProductEndpoint = mongoose.model('Product', ProductSchema); // The schema decorator might override name, but explicit model name is 'Product' or 'ProductModel'
    // Actually ProductModel class might have @Schema({collection: 'products'}). 
    // Mongoose.model('ProductModel', ... ) works too if we want to align with injection token, 
    // but here we just need access to the collection.

    // In NestJS @InjectModel(ProductModel.name) uses the class name 'ProductModel' usually.
    // Let's check ProductSchema definition: export const ProductSchema = SchemaFactory.createForClass(ProductModel);
    // And @Schema({ collection: 'products' })

    const Product = mongoose.model('ProductModel', ProductSchema);
    const Listing = mongoose.model('ListingModel', ListingSchema);

    // [FIX] Drop old index if exists to allow partial index creation
    try {
        if (await Listing.collection.indexExists('marketplaceId_1_externalId_1')) {
            console.log('Removendo índice antigo (marketplaceId_1_externalId_1)...');
            await Listing.collection.dropIndex('marketplaceId_1_externalId_1');
            console.log('Índice antigo removido.');
        }
    } catch (idxErr) {
        // Ignore specific error if index not found (in case indexExists check failed or race condition)
        // console.log('Info: Índice antigo não precisou ser removido ou erro ignorável.');
    }

    // Force index sync
    console.log('Sincronizando índices...');
    await Listing.syncIndexes();

    const products = await Product.find({ titles: { $exists: true, $not: { $size: 0 } } }).exec();
    console.log(`Encontrados ${products.length} produtos com títulos.`);

    let createdCount = 0;
    let errorCount = 0;

    for (const product of products) {
        // Cast to any to access titles comfortably
        const p = product as any;

        try {
            if (!p.titles || p.titles.length === 0) continue;

            for (const title of p.titles) {
                const hasExternalId = !!title.externalId;
                const status = hasExternalId ? 'active' : 'pending_creation';

                // We need to map the fields correctly.
                // ListingSchema expects: productId, marketplaceId, externalId, title, status...

                const newListing = {
                    productId: p._id,
                    marketplaceId: title.marketplaceId,
                    externalId: title.externalId,
                    title: title.title,
                    status: status,
                    synchronized: true,
                    marketplaceData: title.marketplaceData,
                    lastSyncAt: title.lastSyncAt,
                    // If the old defined schema had other fields, map them here
                };

                let existing;
                if (title.externalId) {
                    existing = await Listing.findOne({
                        marketplaceId: title.marketplaceId,
                        externalId: title.externalId
                    });
                } else {
                    existing = await Listing.findOne({
                        productId: p._id,
                        marketplaceId: title.marketplaceId,
                        title: title.title
                    });
                }

                if (!existing) {
                    await Listing.create(newListing);
                    createdCount++;
                    process.stdout.write('.'); // Progress indicator
                }
            }
        } catch (err) {
            console.error(`\nErro ao migrar produto ${p._id}: ${err.message}`);
            errorCount++;
        }
    }

    console.log(`\nMigração concluída.`);
    console.log(`Listings criados: ${createdCount}`);
    console.log(`Erros: ${errorCount}`);

    await mongoose.disconnect();
}

bootstrap().catch(err => {
    console.error('Fatal Error:', err);
    process.exit(1);
});
