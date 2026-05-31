// backend/src/database/general-database.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { GENERAL_CONNECTION } from './connections';

/**
 * Registra a conexão Mongoose `general`, apontando para o banco físico
 * separado dos itens gerais (MONGO_URI_GENERAL).
 *
 * Fail-fast: se MONGO_URI_GENERAL não estiver definida, o app falha no boot
 * com erro claro — nunca cai silenciosamente na DB de autopeças.
 *
 * A conexão default (MONGO_URI) NÃO é tocada aqui — segue registrada no
 * AppModule e continua servindo autopeças.
 */
@Module({
  imports: [
    MongooseModule.forRootAsync({
      connectionName: GENERAL_CONNECTION,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('MONGO_URI_GENERAL'),
      }),
    }),
  ],
})
export class GeneralDatabaseModule {}
