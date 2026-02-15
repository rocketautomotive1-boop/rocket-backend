
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { getModelToken } from '@nestjs/mongoose';
import { ProductModel } from '../src/product/schemas/product.schema';
import { Model, Types } from 'mongoose';
import { Logger } from '@nestjs/common';
import { ProductService } from '../src/product/product.service';

async function bootstrap() {
    const logger = new Logger('VerifyNCM');
    const app = await NestFactory.createApplicationContext(AppModule);

    try {
        const productService = app.get(ProductService);
        const productModel = app.get<Model<ProductModel>>(getModelToken(ProductModel.name));

        logger.log('Creating test product...');
        // Create a dummy product
        const rnd = Math.floor(Math.random() * 100000);
        const product = await productService.create({
            partNumber: `TEST-NCM-${rnd}`,
            name: `Test Product NCM ${rnd}`,
            brand: { id: 1, name: 'TestBrand', isGenuine: true }
        });

        logger.log(`Product created with SKU: ${product.sku} (_id: ${(product as any)._id})`);

        // Verify initial NCM is undefined
        let fetched = await productService.findOne(product.sku);
        if ((fetched as any).ncm) {
            logger.warn(`Initial NCM should be undefined, but got: ${(fetched as any).ncm}`);
        } else {
            logger.log('Initial NCM is empty as expected.');
        }

        // Call updateDetails
        logger.log('Calling updateDetails with NCM 12345678...');
        await productService.updateDetails(product.sku, {
            ncm: '12345678',
            cfop: '1234',
            origin: '0'
        });

        // Verify persistence
        fetched = await productService.findOne(product.sku);
        const ncm = (fetched as any).ncm;
        const cfop = (fetched as any).cfop;

        if (ncm === '12345678' && cfop === '1234') {
            logger.log('SUCCESS: NCM and CFOP persisted correctly!');
        } else {
            logger.error(`FAILURE: Expected NCM=12345678, got ${ncm}`);
            logger.error(`FAILURE: Expected CFOP=1234, got ${cfop}`);
            logger.error(`Full document: ${JSON.stringify(fetched)}`);
        }

        // Clean up
        await productService.remove(product.sku);
        logger.log('Test product removed.');

    } catch (error) {
        logger.error('Fatal:', error);
    } finally {
        await app.close();
        process.exit(0);
    }
}

bootstrap();
