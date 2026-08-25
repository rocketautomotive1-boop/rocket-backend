
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ProductService } from '../src/product/product.service';
import { ProductRepository } from '../src/product/product.repository';
import { Logger } from '@nestjs/common';
import { Types } from 'mongoose';

async function bootstrap() {
    const app = await NestFactory.createApplicationContext(AppModule);
    const productService = app.get(ProductService);
    const productRepository = app.get(ProductRepository);
    const logger = new Logger('StockVerification');

    try {
        logger.log('Starting Stock Calculation Verification...');

        // 1. Create Test Product
        const product = await productService.create({
            partNumber: `TEST-STOCK-${Date.now()}`,
            name: 'Test Stock Product',
            price: 100,
            active: true
        });
        logger.log(`Created Product: ${product.partNumber} (${product._id})`);

        // 2. Add Inbound (+10)
        // 2. Add Inbound (+10)
        await productService.createMovement(product._id, {
            type: 'inbound',
            quantity: 10,
            reason: 'Initial Stock'
        });
        logger.log('Added Inbound: 10');

        // 3. Add Adjustment (-2) -- This was the problematic type
        // 3. Add Adjustment (-2) -- This was the problematic type
        await productService.createMovement(product._id, {
            type: 'adjustment', // treated as outbound/reduction in service
            quantity: 2,
            reason: 'Loss'
        });
        logger.log('Added Adjustment: -2');

        // 4. Add Transfer (-3) -- Also problematic
        // 4. Add Transfer (-3) -- Also problematic
        await productService.createMovement(product._id, {
            type: 'transfer',
            quantity: 3,
            reason: 'Transfer out'
        });
        logger.log('Added Transfer: -3');

        // 5. Verify Stock
        // Expected: 10 - 2 - 3 = 5
        // 5. Verify Stock
        // Expected: 10 - 2 - 3 = 5
        const stock = await productRepository.calculateStock(product._id);
        const productDoc = await productService.findOne(product._id);

        logger.log(`Calculated Stock via Repository: ${stock}`);
        logger.log(`Stored Stock in Product Doc: ${productDoc.stockQuantity}`);

        if (stock === 5) {
            logger.log('✅ SUCCESS: Stock calculation is correct!');
        } else {
            logger.error(`❌ FAILURE: Expected stock 5, got ${stock}`);
        }

        // Cleanup
        // Cleanup
        await productService.remove(product._id);
        logger.log('Cleanup complete.');

    } catch (error) {
        logger.error('Verification failed', error);
    } finally {
        await app.close();
    }
}

bootstrap();
