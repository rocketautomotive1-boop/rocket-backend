import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PublicationAttempt, PublicationAttemptDocument, PublicationStatus, PublicationResult } from '../schemas/publication-attempt.schema';

@Injectable()
export class PublicationLogService {
    private readonly logger = new Logger(PublicationLogService.name);

    constructor(
        @InjectModel(PublicationAttempt.name) private attemptModel: Model<PublicationAttemptDocument>,
    ) { }

    async createAttempt(
        productId: string,
        triggeredBy: string,
        targetMarketplaces: string[] = [],
        metadata: any = {}
    ): Promise<PublicationAttemptDocument> {
        const attempt = new this.attemptModel({
            productId: new Types.ObjectId(productId),
            triggeredBy,
            targetMarketplaces,
            metadata,
            status: PublicationStatus.PENDING,
            logs: [{ timestamp: new Date(), level: 'INFO', message: 'Publication attempt created' }]
        });
        return attempt.save();
    }

    async updateStatus(id: string, status: PublicationStatus): Promise<void> {
        await this.attemptModel.updateOne({ _id: id }, { status });
    }

    async addResult(id: string, result: PublicationResult): Promise<void> {
        await this.attemptModel.updateOne(
            { _id: id },
            { $push: { results: result } }
        );
    }

    async log(id: string, level: 'INFO' | 'WARN' | 'ERROR', message: string, context?: any): Promise<void> {
        await this.attemptModel.updateOne(
            { _id: id },
            {
                $push: {
                    logs: {
                        timestamp: new Date(),
                        level,
                        message,
                        context
                    }
                }
            }
        );
    }

    async completeAttempt(id: string, results: PublicationResult[]): Promise<void> {
        const hasFailures = results.some(r => r.status === 'FAILED');
        const status = hasFailures
            ? (results.some(r => r.status === 'SUCCESS') ? PublicationStatus.PARTIAL_FAILURE : PublicationStatus.FAILED)
            : PublicationStatus.COMPLETED;

        await this.attemptModel.updateOne(
            { _id: id },
            {
                status,
                results: results, // Overwrite results if bulk update
                $push: { logs: { timestamp: new Date(), level: 'INFO', message: `Publication completed with status: ${status}` } }
            }
        );
    }

    async failAttempt(id: string, error: string): Promise<void> {
        await this.attemptModel.updateOne(
            { _id: id },
            {
                status: PublicationStatus.FAILED,
                $push: { logs: { timestamp: new Date(), level: 'ERROR', message: `Publication failed fatally: ${error}` } }
            }
        );
    }

    async findById(id: string): Promise<PublicationAttemptDocument> {
        return this.attemptModel.findById(id).exec();
    }

    async findPendingByJobId(jobId: string): Promise<PublicationAttemptDocument | null> {
        if (!jobId) return null;
        return this.attemptModel.findOne({
            status: PublicationStatus.PENDING,
            'metadata.jobId': jobId,
        }).exec();
    }

    async findPending(): Promise<PublicationAttemptDocument[]> {
        return this.attemptModel.find({ status: PublicationStatus.PENDING }).exec();
    }
}
