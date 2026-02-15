
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ProductService } from '../src/product/product.service';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

async function bootstrap() {
    const app = await NestFactory.createApplicationContext(AppModule);
    const connection = app.get<Connection>(getConnectionToken());
    const productModel = connection.model('Product');

    const productId = '696a434bf40b34995533acec';

    console.log(`Inspecting Product: ${productId}`);

    const product = await productModel.findById(productId).exec();

    if (!product) {
        console.log('Product not found.');
    } else {
        console.log('Product Titles:');
        console.log(JSON.stringify(product['titles'], null, 2));
    }

    await app.close();
    process.exit(0);
}

bootstrap();
