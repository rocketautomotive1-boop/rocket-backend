import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Product } from '../src/product/entities/product.entity';
import { Logger } from '@nestjs/common';

async function bootstrap() {
    const logger = new Logger('Inspect');
    const app = await NestFactory.createApplicationContext(AppModule);

    try {
        const repo = app.get(getRepositoryToken(Product));

        logger.log('--- Product Attributes Columns ---');
        const attrs = await repo.manager.query('SELECT * FROM product_attributes LIMIT 1');
        if (attrs.length) console.log(Object.keys(attrs[0]));
        else console.log('No attributes found');

        logger.log('--- Box Items Columns ---');
        const items = await repo.manager.query('SELECT * FROM box_items LIMIT 1');
        if (items.length) console.log(Object.keys(items[0]));
        else console.log('No box items found');

    } catch (error) {
        logger.error(error);
    } finally {
        await app.close();
    }
}

bootstrap();
