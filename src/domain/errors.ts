export class SilentCartError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export class ValidationError extends SilentCartError {
  public constructor(message: string) {
    super("validation_error", message);
  }
}

export class NotFoundError extends SilentCartError {
  public constructor(message: string) {
    super("not_found", message);
  }
}

export class UnauthorizedError extends SilentCartError {
  public constructor(message: string) {
    super("unauthorized", message);
  }
}

export class ConflictError extends SilentCartError {
  public constructor(message: string) {
    super("conflict", message);
  }
}

export class ExternalServiceError extends SilentCartError {
  public constructor(message: string) {
    super("external_service_error", message);
  }
}
