import {
    Controller,
    Post,
    Get,
    UploadedFile,
    UseInterceptors,
    Body,
    Query,
    Logger,
    BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as WebSocket from 'ws';
import { ProcessedImageService } from './processed-image.service';

@Controller('rembg')
export class RembgController {
    private readonly logger = new Logger(RembgController.name);

    constructor(
        private readonly processedImageService: ProcessedImageService,
    ) { }

    private generateBatchCode(): string {
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
        const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
        const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
        return `RB-${date}-${time}-${suffix}`;
    }

    @Get('repository')
    async listRepository(
        @Query('batchCode') batchCode?: string,
        @Query('search') search?: string,
        @Query('page') pageParam?: string,
        @Query('limit') limitParam?: string,
    ): Promise<any> {
        const page = Number(pageParam || '1');
        const limit = Number(limitParam || '30');

        return this.processedImageService.listProcessedImages({
            batchCode,
            search,
            page: Number.isFinite(page) ? page : 1,
            limit: Number.isFinite(limit) ? limit : 30,
        });
    }

    @Post('process')
    @UseInterceptors(FileInterceptor('file'))
    async processImage(
        @UploadedFile() file: any, // Using any to avoid Multer type issues
        @Body('metadata') metadataStr?: string,
    ): Promise<any> {
        this.logger.log(`Received HTTP image upload: ${file?.originalname}`);

        if (!file) {
            throw new BadRequestException('No file uploaded');
        }

        let metadata: any = {};
        if (metadataStr) {
            try {
                metadata = JSON.parse(metadataStr);
            } catch {
                throw new BadRequestException('Invalid metadata JSON');
            }
        }

        const batchCodeFromPayload = metadata?.batchCode || metadata?.batch_code;
        const batchNote = metadata?.batchNote || metadata?.batch_note || null;
        const productId = metadata?.product_id ? String(metadata.product_id) : null;
        const batchCode = typeof batchCodeFromPayload === 'string' && batchCodeFromPayload.trim()
            ? batchCodeFromPayload.trim()
            : this.generateBatchCode();

        // Backward compatible: old clients can omit batchCode/batchNote.
        metadata = {
            ...metadata,
            batchCode,
            ...(batchNote ? { batchNote } : {}),
        };

        this.logger.debug(`Metadata: ${JSON.stringify(metadata)}`);
        this.logger.debug(`File size: ${file.size} bytes`);

        return new Promise((resolve, reject) => {
            const pythonWsUrl = process.env.REMBG_WS_URL || 'ws://localhost:5000/ws';
            const serviceWs = new WebSocket(pythonWsUrl);
            let isResolved = false;

            const safeResolve = (val: any) => {
                if (!isResolved) {
                    isResolved = true;
                    resolve(val);
                }
            };

            const timeout = setTimeout(() => {
                this.logger.error(`Timeout waiting for Python Service response`);
                serviceWs.terminate();
                safeResolve({ status: 'error', message: 'Timeout processing image' });
            }, 60000);

            serviceWs.on('open', () => {
                this.logger.debug(`Connected to Python Service`);

                try {
                    const metaStr = JSON.stringify(metadata);
                    this.logger.debug(`Sending metadata... ${metaStr.length} chars`);
                    serviceWs.send(metaStr);

                    this.logger.debug(`Sending binary data: ${file.buffer.length} bytes`);
                    serviceWs.send(file.buffer);
                    this.logger.debug(`Data sent successfully`);
                } catch (e) {
                    this.logger.error(`Error sending data to Python Service: ${e.message}`);
                    clearTimeout(timeout);
                    serviceWs.close();
                    safeResolve({ status: 'error', message: 'Failed to send data to service' });
                }
            });

            serviceWs.on('message', async (data) => {
                clearTimeout(timeout);
                try {
                    const response = JSON.parse(data.toString());
                    this.logger.log(`Received response from Python Service: ${response.status}`);
                    if (response?.status === 'success' && response?.url && response?.key) {
                        try {
                            const source = metadata?.options?.use_photoroom
                                ? 'photoroom'
                                : metadata?.options?.model || null;

                            await this.processedImageService.saveProcessedImage({
                                batchCode,
                                batchNote,
                                productId,
                                url: response.url,
                                key: response.key,
                                mimeType: 'image/png',
                                fileName: file?.originalname || null,
                                source,
                            });
                        } catch (persistError: any) {
                            this.logger.error(`Failed to persist processed image: ${persistError?.message}`);
                        }
                    }

                    safeResolve({
                        ...response,
                        batchCode,
                        batchNote,
                    });
                } catch (e) {
                    this.logger.error(`Invalid JSON from Python Service: ${data}`);
                    safeResolve({ status: 'error', message: 'Invalid response from service' });
                } finally {
                    serviceWs.close();
                }
            });

            serviceWs.on('error', (error) => {
                clearTimeout(timeout);
                this.logger.error(`Python Service Socket Error: ${error.message}`);
                safeResolve({ status: 'error', message: 'Internal Service Error' });
            });

            serviceWs.on('close', (code, reason) => {
                this.logger.warn(`Python Service Disconnected. Code: ${code}, Reason: ${reason}`);
                clearTimeout(timeout);
                if (!isResolved) {
                    safeResolve({ status: 'error', message: 'Service closed connection unexpectedly' });
                }
            });
        });
    }
}
