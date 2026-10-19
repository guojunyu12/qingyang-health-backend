export class ApiFailure extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public retryAfterSeconds?: number,
  ) {
    super(message);
  }
}
export function reject(
  status: number,
  code: string,
  message: string,
  retryAfterSeconds?: number,
): never {
  throw new ApiFailure(status, code, message, retryAfterSeconds);
}
