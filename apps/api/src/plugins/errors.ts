import type { FastifyError, FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { AppError, errorBody } from '../errors';

/**
 * Every failure leaves the API as `{ error: { code, message } }`.
 * Unexpected errors are logged in full but reach the client only as a generic 500.
 */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) => {
    return reply
      .status(404)
      .send(errorBody('NOT_FOUND', `Route ${request.method} ${request.url} not found`));
  });

  app.setErrorHandler<FastifyError | AppError>((err, request, reply) => {
    if (err instanceof AppError) {
      if (err.statusCode >= 500) request.log.error({ err }, err.message);
      return reply.status(err.statusCode).send(errorBody(err.code, err.message));
    }

    if (hasZodFastifySchemaValidationErrors(err)) {
      const detail = err.validation
        .map((v) =>
          `${v.instancePath || err.validationContext || 'request'} ${v.message ?? ''}`.trim(),
        )
        .join('; ');
      return reply.status(400).send(errorBody('VALIDATION_ERROR', detail));
    }

    // Fastify's own client errors (bad JSON, payload too large, ...) are safe to pass through.
    if (err.statusCode !== undefined && err.statusCode >= 400 && err.statusCode < 500) {
      return reply.status(err.statusCode).send(errorBody(err.code || 'BAD_REQUEST', err.message));
    }

    request.log.error({ err }, 'Unhandled error');
    return reply.status(500).send(errorBody('INTERNAL_ERROR', 'Something went wrong'));
  });
}
