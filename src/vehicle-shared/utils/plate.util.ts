const OLD_FORMAT = /^[A-Z]{3}[0-9]{4}$/;
const MERCOSUL_FORMAT = /^[A-Z]{3}[0-9][A-Z][0-9]{2}$/;

export function normalizePlate(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isValidPlate(plate: string): boolean {
  return OLD_FORMAT.test(plate) || MERCOSUL_FORMAT.test(plate);
}
