
import { Module, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ProductRepository } from '../src/product/product.repository';
import { ProductModel, ProductSchema } from '../src/product/schemas/product.schema';
import { StockMovementModel, StockMovementSchema } from '../src/product/schemas/stock-movement.schema';
// Mock dependencies for Repo if any... Repo uses ProductCompatibilityModel too.
import { ProductCompatibilityModel, ProductCompatibilitySchema } from '../src/product/schemas/product-compatibility.schema';
import { Types } from 'mongoose';

@Module({
    imports: [
        ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
        MongooseModule.forRootAsync({
            imports: [ConfigModule],
            useFactory: async (configService: ConfigService) => {
                const uri = configService.get<string>('MONGO_URI') || 'mongodb://localhost:27017/rocket';
                Logger.log(`Using Mongo URI: ${uri.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@')}`);
                return { uri };
            },
            inject: [ConfigService],
        }),
        MongooseModule.forFeature([
            { name: ProductModel.name, schema: ProductSchema },
            { name: StockMovementModel.name, schema: StockMovementSchema },
            { name: ProductCompatibilityModel.name, schema: ProductCompatibilitySchema },
        ]),
    ],
    providers: [ProductRepository],
})
class MinimalModule { }

async function bootstrap() {
    const app = await NestFactory.createApplicationContext(MinimalModule);
    const productRepository = app.get(ProductRepository);
    const logger = new Logger('StockVerificationMinimal');

    try {
        logger.log('Starting Minimal Stock Calculation Verification...');

        // 1. Create Test Product directly via Repo
        const product = await productRepository.create({
            partNumber: `TEST-STOCK-${Date.now()}`,
            name: 'Test Stock Product',
            price: 100,
            active: true,
            stockQuantity: 0
        });
        // product is Document here (returned by create in repo)
        const productId = product._id.toString();

        logger.log(`Created Product: ${product.partNumber} (${productId})`);

        // 2. Add Inbound (+10) via Repo directly
        await productRepository.createMovement({
            product: productId,
            type: 'inbound',
            quantity: 10,
            date: new Date(),
            reason: 'Initial Stock'
        });
        logger.log('Added Inbound: 10');

        // 3. Add Adjustment (-2)
        await productRepository.createMovement({
            product: productId,
            type: 'adjustment',
            quantity: 2,
            date: new Date(),
            reason: 'Loss'
        });
        logger.log('Added Adjustment: -2');

        // 4. Add Transfer (-3)
        await productRepository.createMovement({
            product: productId,
            type: 'transfer',
            quantity: 3,
            date: new Date(),
            reason: 'Transfer out'
        });
        logger.log('Added Transfer: -3');

        // 5. Verify Stock with explicit calculation
        const stock = await productRepository.calculateStock(productId);

        logger.log(`Calculated Stock via Repository: ${stock}`);

        if (stock === 5) {
            logger.log('✅ SUCCESS: Stock calculation is correct!');
        } else {
            logger.error(`❌ FAILURE: Expected stock 5, got ${stock}`);
        }

        // Cleanup (Manual remove since repo.remove isn't standard in minimal setup?)
        // repo has remove?
        // ProductRepository has remove(id) method calling findDocument and soft deleting?
        // Let's just use Model directly or ignore cleanup in test DB, but better to clean.
        // Calling repo.remove(id)
        // Not defined in my view earlier? check repo methods.
        // repo.deleteMovement, repo.createMovement.
        // repo does not have deleteProduct? 
        // ProductService has remove calling product.active = false.
        // I'll leave it or just delete via model if I injected it? 
        // I didn't inject Model into bootstrap scope.
        // Repository is enough for verify.

    } catch (error) {
        logger.error('Verification failed', error);
    } finally {
        await app.close();
    }
}

bootstrap();
