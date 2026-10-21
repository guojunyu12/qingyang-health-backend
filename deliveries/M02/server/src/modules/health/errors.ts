export class HealthError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}
export function invalid(field: string, message: string): never {
  throw new HealthError(422, "VALIDATION_ERROR", message, { [field]: message });
}
