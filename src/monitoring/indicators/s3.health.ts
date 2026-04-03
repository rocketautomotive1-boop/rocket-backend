import { Injectable } from '@nestjs/common';
import { HealthCheckError, HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import { S3Service } from '../../common/s3/s3.service';

@Injectable()
export class S3HealthIndicator extends HealthIndicator {
  constructor(private readonly s3Service: S3Service) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      const isUp = await this.s3Service.ping();
      if (!isUp) {
        throw new Error('S3 connection check failed');
      }
      return this.getStatus(key, true);
    } catch (error) {
      throw new HealthCheckError('S3 check failed', this.getStatus(key, false, { message: error.message }));
    }
  }
}
