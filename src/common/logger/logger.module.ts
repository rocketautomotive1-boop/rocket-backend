import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';
import 'winston-daily-rotate-file';
import { utilities as nestWinstonModuleUtilities } from 'nest-winston';

@Module({
  imports: [
    WinstonModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const logDir = configService.get('LOG_DIR', 'logs');
        const logLevel = configService.get('LOG_LEVEL', 'info');
        const maxSize = configService.get('LOG_MAX_SIZE', '20m');
        const maxFiles = configService.get('LOG_MAX_FILES', '14d');
        
        // Formato personalizado para logs
        const customFormat = winston.format.combine(
          winston.format.timestamp(),
          winston.format.ms(),
          nestWinstonModuleUtilities.format.nestLike('MarketplaceIntegration', {
            colors: true,
            prettyPrint: true,
          }),
        );
        
        return {
          transports: [
            // Console transport para desenvolvimento
            new winston.transports.Console({
              format: customFormat,
            }),
            
            // Arquivo de log para todos os níveis
            new winston.transports.DailyRotateFile({
              dirname: logDir,
              filename: 'application-%DATE%.log',
              datePattern: 'YYYY-MM-DD',
              maxSize,
              maxFiles,
              format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.json(),
              ),
            }),
            
            // Arquivo de log específico para erros
            new winston.transports.DailyRotateFile({
              dirname: logDir,
              filename: 'error-%DATE%.log',
              datePattern: 'YYYY-MM-DD',
              maxSize,
              maxFiles,
              level: 'error',
              format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.json(),
              ),
            }),
            
            // Arquivo de log específico para marketplaces
            new winston.transports.DailyRotateFile({
              dirname: `${logDir}/marketplaces`,
              filename: 'marketplace-%DATE%.log',
              datePattern: 'YYYY-MM-DD',
              maxSize,
              maxFiles,
              format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.json(),
              ),
            }),
            
            // Arquivo de log específico para filas
            new winston.transports.DailyRotateFile({
              dirname: `${logDir}/queues`,
              filename: 'queue-%DATE%.log',
              datePattern: 'YYYY-MM-DD',
              maxSize,
              maxFiles,
              format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.json(),
              ),
            }),
          ],
          // Nível de log global
          level: logLevel,
        };
      },
    }),
  ],
  exports: [WinstonModule],
})
export class LoggerModule {}
