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

export class VehicleCompatibilityGroupNotFoundException extends NotFoundException {
  constructor(id: string) {
    super(`Vehicle compatibility group not found: ${id}`);
  }
}

export class VehicleCompatibilityInUseException extends ConflictException {
  constructor(count: number, products: Array<{ id: string; name: string }>) {
    super({
      message: `Veículo vinculado a ${count} produto(s); remova a compatibilidade antes de excluir.`,
      count,
      products,
    });
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

export class InvalidPlateFormatException extends BadRequestException {
  constructor(plate: string) {
    super(`Formato de placa inválido: ${plate}`);
  }
}

export class PlateNotFoundException extends NotFoundException {
  constructor(plate: string) {
    super(`Não conseguimos localizar essa placa: ${plate}`);
  }
}
