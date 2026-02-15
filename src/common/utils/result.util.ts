/**
 * Standard Result Pattern for professional service responses.
 * Avoids throwing exceptions for business logic failures.
 */
export class Result<T = any, E = string> {
    public readonly isSuccess: boolean;
    public readonly isFailure: boolean;
    public readonly error: E | null;
    private readonly _value: T | null;

    private constructor(isSuccess: boolean, error?: E, value?: T) {
        this.isSuccess = isSuccess;
        this.isFailure = !isSuccess;
        this.error = error || null;
        this._value = value || null;

        Object.freeze(this);
    }

    public getValue(): T {
        if (!this.isSuccess) {
            throw new Error('Can not get the value of a failure result. Use error instead.');
        }
        return this._value as T;
    }

    public static ok<U>(value?: U): Result<U> {
        return new Result<U>(true, null as any, value);
    }

    public static fail<U>(error: string): Result<U> {
        return new Result<U>(false, error as any);
    }

    public static combine(results: Result<any>[]): Result<any> {
        for (const result of results) {
            if (result.isFailure) return result;
        }
        return Result.ok();
    }
}

/**
 * Common App Response wrapper for Controllers
 */
export interface AppResponse<T = any> {
    success: boolean;
    data?: T;
    error?: string;
    message?: string;
}
