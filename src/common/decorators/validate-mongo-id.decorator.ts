import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';

/**
 * Decorator to validate if a method argument is a valid MongoDB ObjectId.
 * By default checks the first argument (index 0).
 * 
 * @param index Index of the argument to validate
 */
export function ValidateMongoId(index: number = 0) {
    return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
        const originalMethod = descriptor.value;

        descriptor.value = function (...args: any[]) {
            const id = args[index];

            // Only validate if it's a string (or object that should be ID). 
            // If it's undefined/null, let the method handle or let it fail if required.
            // But typically we want to block invalid strings.
            if (typeof id === 'string' && !Types.ObjectId.isValid(id)) {
                throw new BadRequestException(`Invalid ID format: ${id}`);
            }

            return originalMethod.apply(this, args);
        };

        return descriptor;
    };
}
