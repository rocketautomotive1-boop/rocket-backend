import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

export class VehicleDiscoveryNotFoundException extends NotFoundException {
  constructor(id: string) {
    super(`Vehicle discovery not found: ${id}`);
  }
}

export class VehicleCompatibilityNotFoundException extends NotFoundException {
  constructor(id: string) {
    super(`Vehicle compatibility not found: ${id}`);
  }
}

export class VehicleDiscoveryDuplicateException extends ConflictException {
  constructor(lockKey: string) {
    super(`Duplicate pending/processing discovery for key: ${lockKey}`);
  }
}

export class VehicleDiscoveryInvalidStatusException extends BadRequestException {
  constructor(current: string, allowed: string[]) {
    super(`Invalid status transition from "${current}". Allowed: ${allowed.join(', ')}`);
  }
}

export class VehicleAiParseException extends BadRequestException {
  constructor(raw?: string) {
    super(`Failed to parse AI response${raw ? `: ${raw.slice(0, 150)}` : ''}`);
  }
}
