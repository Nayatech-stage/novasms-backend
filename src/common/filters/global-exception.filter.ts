import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = "Une erreur inattendue s'est produite. Veuillez réessayer.";
    let errors: string[] | undefined;

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const body = exception.getResponse();

      if (typeof body === 'string') {
        message = this.toUserMessage(statusCode, body);
      } else if (typeof body === 'object' && body !== null) {
        const b = body as Record<string, unknown>;

        // ValidationPipe retourne { message: string[] }
        if (Array.isArray(b.message)) {
          errors = (b.message as unknown[])
            .filter((m) => typeof m === 'string')
            .map((m) => m as string);
          message = 'Les données saisies sont invalides.';
        } else if (typeof b.message === 'string') {
          message = this.toUserMessage(statusCode, b.message);
        } else if (typeof b.error === 'string') {
          message = this.toUserMessage(statusCode, b.error);
        }
      }
    } else {
      // Erreur technique inconnue — log complet côté serveur, message générique côté client
      const err =
        exception instanceof Error ? exception : new Error(String(exception));
      this.logger.error(
        `Unhandled exception on ${request.method} ${request.url}: ${err.message}`,
        err.stack,
      );
    }

    response.status(statusCode).json({
      success: false,
      statusCode,
      message,
      ...(errors ? { errors } : {}),
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }

  private toUserMessage(status: number, raw: string): string {
    // Messages techniques internes → message générique
    if (this.isTechnical(raw)) {
      return this.defaultForStatus(status);
    }
    return raw;
  }

  private isTechnical(msg: string): boolean {
    const technical = [
      'prisma',
      'database',
      'sql',
      'connection',
      'timeout',
      'econnrefused',
      'enotfound',
      'stack',
      'null pointer',
      'undefined is not',
      'cannot read',
      'error:',
      'exception:',
    ];
    const lower = msg.toLowerCase();
    return technical.some((t) => lower.includes(t));
  }

  private defaultForStatus(status: number): string {
    const messages: Record<number, string> = {
      400: 'La requête est incorrecte.',
      401: 'Vous devez être connecté pour effectuer cette action.',
      403: "Vous n'avez pas les droits pour effectuer cette action.",
      404: 'La ressource demandée est introuvable.',
      409: 'Un conflit a été détecté. Vérifiez les données saisies.',
      422: 'Les données envoyées ne sont pas valides.',
      429: 'Trop de requêtes. Veuillez patienter quelques instants.',
      500: "Une erreur inattendue s'est produite. Veuillez réessayer.",
      502: 'Le serveur est temporairement indisponible.',
      503: 'Le service est momentanément indisponible. Réessayez dans quelques instants.',
    };
    return messages[status] ?? "Une erreur s'est produite. Veuillez réessayer.";
  }
}
