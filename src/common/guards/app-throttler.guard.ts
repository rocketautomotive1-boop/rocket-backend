import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
    protected async handleRequest(requestProps: any): Promise<boolean> {
        const { context } = requestProps;
        const type = context.getType();

        // STRICT BYPASS: If context is not HTTP, return true immediately.
        // DO NOT call super.handleRequest() for non-HTTP contexts as it attempts to set headers.
        if (type === 'rpc' || type === 'ws' || type !== 'http') {
            return true;
        }

        // Only call super for verified HTTP contexts
        return super.handleRequest(requestProps);
    }
}
