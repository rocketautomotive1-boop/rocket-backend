import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { getModelToken } from '@nestjs/mongoose';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserModel } from '../src/auth/schemas/user.schema';
import { User } from '../src/auth/entities/user.entity';
import { Model } from 'mongoose';
import { Logger } from '@nestjs/common';

async function bootstrap() {
    const logger = new Logger('MigrateUsers');
    const app = await NestFactory.createApplicationContext(AppModule);

    try {
        const userModel = app.get<Model<UserModel>>(getModelToken(UserModel.name));
        const userRepo = app.get(getRepositoryToken(User));

        logger.log('Starting User Migration (MySQL -> Mongo)...');

        // 1. Clear existing (Safe)
        logger.warn('Dropping existing users...');
        try { await userModel.collection.drop(); } catch (e) { }
        logger.log('Users cleared.');

        // 2. Fetch from MySQL
        const users = await userRepo.find();

        const bulkOps = users.map(u => ({
            insertOne: {
                document: {
                    name: u.name,
                    email: u.email,
                    password: u.password, // Hash
                    isActive: u.isActive,
                    roles: u.roles,
                    permissions: u.permissions,
                    pushTokens: u.pushTokens,
                    legacyId: u.id
                }
            }
        }));

        if (bulkOps.length > 0) {
            await userModel.bulkWrite(bulkOps);
            logger.log(`Migration Completed. Success: ${bulkOps.length}`);
        } else {
            logger.warn('No users found to migrate.');
        }

    } catch (error) {
        logger.error('Fatal:', error);
    } finally {
        await app.close();
    }
}

bootstrap();
