import { TrackController } from './track.controller';
import { TrackService } from './track.service';

describe('TrackController — GET /track/open et /track/click (NEW-T01/NEW-T02)', () => {
  const service = {
    trackOpen: jest.fn().mockResolvedValue(undefined),
    trackClick: jest.fn().mockResolvedValue(undefined),
  };

  let controller: TrackController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new TrackController(service as unknown as TrackService);
  });

  it('open : renvoie un GIF 1x1 non cacheable et trace l’ouverture', async () => {
    const setHeader = jest.fn();
    const send = jest.fn();
    const status = jest.fn().mockReturnValue({ send });

    await controller.open('send-1', 'token-1', {
      setHeader,
      status,
    } as never);

    expect(service.trackOpen).toHaveBeenCalledWith('send-1', 'token-1');
    expect(setHeader).toHaveBeenCalledWith('Content-Type', 'image/gif');
    expect(setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      expect.stringContaining('no-store'),
    );
    expect(status).toHaveBeenCalledWith(200);
    expect(send.mock.calls[0][0]).toBeInstanceOf(Buffer);
  });

  it('click : trace le clic puis redirige en 302 vers l’URL cible', async () => {
    const redirect = jest.fn();

    await controller.click(
      'send-1',
      encodeURIComponent('https://shop.example.ci/promo'),
      'token-1',
      'cta',
      { redirect } as never,
    );

    expect(service.trackClick).toHaveBeenCalledWith('send-1', 'token-1', 'cta');
    expect(redirect).toHaveBeenCalledWith(302, 'https://shop.example.ci/promo');
  });

  it('click : neutralise les URLs non http(s) (anti open-redirect)', async () => {
    const redirect = jest.fn();

    await controller.click('send-1', 'javascript:alert(1)', 'token-1', 'cta', {
      redirect,
    } as never);

    expect(redirect).toHaveBeenCalledWith(302, '/');
  });

  it('click : retombe sur / sans URL', async () => {
    const redirect = jest.fn();

    await controller.click('send-1', '', 'token-1', '', {
      redirect,
    } as never);

    expect(redirect).toHaveBeenCalledWith(302, '/');
  });
});
