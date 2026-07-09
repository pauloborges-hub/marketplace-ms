import { HttpException } from '@nestjs/common';

export function isClientError(error: unknown): error is HttpException {
  return error instanceof HttpException && error.getStatus() < 500;
}
