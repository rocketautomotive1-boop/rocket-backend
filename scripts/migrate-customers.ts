import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { getModelToken } from '@nestjs/mongoose';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CustomerModel } from '../src/customer/schemas/customer.schema';
import { Customer } from '../src/customer/entities/customer.entity';
import { Model } from 'mongoose';
import { Logger } from '@nestjs/common';

async function bootstrap() {
    const logger = new Logger('MigrateCustomers');
    const app = await NestFactory.createApplicationContext(AppModule);

    try {
        const customerModel = app.get<Model<CustomerModel>>(getModelToken(CustomerModel.name));
        const customerRepository = app.get(getRepositoryToken(Customer));

        const BATCH_SIZE = 50;
        let page = 0;
        let hasMore = true;
        let successCount = 0;
        let errorCount = 0;

        logger.log('Starting Customer Migration (MySQL -> Mongo)...');

        // 1. Clear existing customers (optional, safe for re-running)
        logger.warn('Dropping existing customers...');
        try { await customerModel.collection.drop(); } catch (e) { }
        logger.log('Customers cleared.');

        while (hasMore) {
            logger.log(`Fetching batch ${page + 1}...`);

            // Fetch Customers with Addresses
            const customers = await customerRepository.find({
                take: BATCH_SIZE,
                skip: page * BATCH_SIZE,
                order: { id: 'ASC' },
                relations: ['addresses']
            });

            if (customers.length === 0) {
                hasMore = false;
                break;
            }

            const bulkOps = [];

            for (const customer of customers) {
                try {
                    const mongoCustomer = {
                        name: customer.name,
                        email: customer.email,
                        password: customer.password,
                        document: customer.document,
                        phone: customer.phone,
                        isActive: customer.isActive,
                        legacyId: customer.id,

                        addresses: customer.addresses?.map(addr => ({
                            alias: addr.alias,
                            street: addr.street,
                            number: addr.number,
                            complement: addr.complement,
                            neighborhood: addr.neighborhood,
                            city: addr.city,
                            state: addr.state,
                            zipCode: addr.zipCode,
                            isDefault: addr.isDefault
                        })) || []
                    };

                    bulkOps.push({
                        insertOne: {
                            document: mongoCustomer
                        }
                    });

                } catch (err: any) {
                    logger.error(`Failed to map Customer ${customer.id}: ${err.message}`);
                    errorCount++;
                }
            }

            if (bulkOps.length > 0) {
                await customerModel.bulkWrite(bulkOps);
                successCount += bulkOps.length;
                logger.log(`Batch ${page + 1}: Inserted ${bulkOps.length} customers.`);
            }

            page++;
        }

        logger.log(`Migration Completed. Success: ${successCount}, Failed: ${errorCount}`);

    } catch (error) {
        logger.error('Fatal:', error);
    } finally {
        await app.close();
    }
}

bootstrap();
