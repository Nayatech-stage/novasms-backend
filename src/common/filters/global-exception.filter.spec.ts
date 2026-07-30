import {
  ArgumentsHost,
  BadRequestException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { GlobalExceptionFilter } from './global-exception.filter';

describe('GlobalExceptionFilter — messages utilisateur sans fuite technique', () => {
  const filter = new GlobalExceptionFilter();

  const makeHost = () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({ method: 'GET', url: '/api/test' }),
      }),
    } as unknown as ArgumentsHost;
    return { host, status, json };
  };

  it('relaie le message métier d’une HttpException', () => {
    const { host, status, json } = makeHost();

    filter.catch(new NotFoundException('Campagne introuvable'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        statusCode: 404,
        message: 'Campagne introuvable',
        path: '/api/test',
      }),
    );
  });

  it('masque les messages techniques (prisma, sql...) derrière un message générique', () => {
    const { host, json } = makeHost();

    filter.catch(
      new BadRequestException('Prisma P2002 unique constraint failed'),
      host,
    );

    const body = json.mock.calls[0][0];
    expect(body.message).toBe('La requête est incorrecte.');
    expect(body.message).not.toContain('Prisma');
  });

  it('agrège les erreurs du ValidationPipe (message: string[])', () => {
    const { host, json } = makeHost();

    filter.catch(
      new BadRequestException({
        message: ['email must be an email', 'name should not be empty'],
      }),
      host,
    );

    const body = json.mock.calls[0][0];
    expect(body.message).toBe('Les données saisies sont invalides.');
    expect(body.errors).toEqual([
      'email must be an email',
      'name should not be empty',
    ]);
  });

  it('retourne 500 générique pour une erreur inconnue sans exposer la stack', () => {
    const { host, status, json } = makeHost();

    filter.catch(new Error('ECONNREFUSED 127.0.0.1:5432'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    const body = json.mock.calls[0][0];
    expect(body.message).toBe(
      "Une erreur inattendue s'est produite. Veuillez réessayer.",
    );
    expect(JSON.stringify(body)).not.toContain('ECONNREFUSED');
  });
});
