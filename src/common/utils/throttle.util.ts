export class Throttle {
    private lastExecution: Map<string, number> = new Map();

    /**
     * Ensures that the given key has waited at least 'delayMs' since its last execution.
     * Useful for per-marketplace or per-endpoint rate limiting.
     */
    async throttle(key: string, delayMs: number): Promise<void> {
        const now = Date.now();
        const last = this.lastExecution.get(key) || 0;
        const elapsed = now - last;

        if (elapsed < delayMs) {
            const waitTime = delayMs - elapsed;
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }

        this.lastExecution.set(key, Date.now());
    }
}

export const globalThrottle = new Throttle();
