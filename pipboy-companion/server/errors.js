export class AppError extends Error {
  constructor(status, code, message, headers = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}
