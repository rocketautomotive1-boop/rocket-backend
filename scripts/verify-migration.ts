import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { getModelToken } from '@nestjs/mongoose';
import { ProductModel } from '../src/product/schemas/product.schema';
import { StockMovementModel } from '../src/product/schemas/stock-movement.schema';
import { Model } from 'mongoose';
import { Logger } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';

async function bootstrap() {
    const logger = new Logger('Verification');
    const app = await NestFactory.createApplicationContext(AppModule);

    try {
        const connection = app.get(getConnectionToken());

        // We can access collections directly to avoid Model dependency injection issues if any
        // or just countDocuments via connection.db

        logger.log('--- Verification Results ---');

        const productCount = await connection.collection('products').countDocuments();
        logger.log(`Products: ${productCount}`);

        const movementCount = await connection.collection('stock_movements').countDocuments();
        logger.log(`Stock Movements: ${movementCount}`);

        const orderCount = await connection.collection('orders').countDocuments();
        logger.log(`Orders: ${orderCount}`);

        const customerCount = await connection.collection('customers').countDocuments();
        logger.log(`Customers: ${customerCount}`);

        const questionCount = await connection.collection('questions').countDocuments();
        logger.log(`Questions: ${questionCount}`);

        const fiscalDocCount = await connection.collection('fiscal_documents').countDocuments();
        logger.log(`Fiscal Documents: ${fiscalDocCount}`);

        const fiscalIssuerCount = await connection.collection('fiscal_issuers').countDocuments();
        logger.log(`Fiscal Issuers: ${fiscalIssuerCount}`);

        const marketplaceCount = await connection.collection('marketplaces').countDocuments();
        logger.log(`Marketplaces: ${marketplaceCount}`);

        const userCount = await connection.collection('users').countDocuments();
        logger.log(`Users: ${userCount}`);

        logger.log('----------------------------');

        if (productCount > 0) {
            const sample = await connection.collection('products').findOne({});
            logger.log('Sample Product:', sample ? sample.name : 'N/A');
        }

    } catch (error) {
        logger.error('Verification failed:', error);
    } finally {
        await app.close();
    }
}

bootstrap();
