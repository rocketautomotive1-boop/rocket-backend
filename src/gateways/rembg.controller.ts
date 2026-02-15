import {
    Controller,
    Post,
    UploadedFile,
    UseInterceptors,
    Body,
    Logger,
    BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as WebSocket from 'ws';

@Controller('rembg')
export class RembgController {
    private readonly logger = new Logger(RembgController.name);

    @Post('process')
    @UseInterceptors(FileInterceptor('file'))
    async processImage(
        @UploadedFile() file: any, // Using any to avoid Multer type issues
        @Body('metadata') metadataStr: string,
    ): Promise<any> {
        this.logger.log(`Received HTTP image upload: ${file?.originalname}`);

        if (!file) {
            throw new BadRequestException('No file uploaded');
        }

        if (!metadataStr) {
            throw new BadRequestException('No metadata provided');
        }

        const metadata = JSON.parse(metadataStr);
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

            serviceWs.on('message', (data) => {
                clearTimeout(timeout);
                try {
                    const response = JSON.parse(data.toString());
                    this.logger.log(`Received response from Python Service: ${response.status}`);
                    safeResolve(response);
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
