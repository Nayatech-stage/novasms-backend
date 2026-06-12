import { FcmPushProvider } from './fcm.push.provider';

describe('FcmPushProvider', () => {
  let provider: FcmPushProvider;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.FCM_PROJECT_ID = 'nova-test';
    process.env.FCM_SERVER_KEY = 'server-key-test';
    provider = new FcmPushProvider();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.FCM_PROJECT_ID;
    delete process.env.FCM_SERVER_KEY;
    jest.restoreAllMocks();
  });

  it('send retourne success avec le messageId FCM', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ name: 'projects/nova-test/messages/m-1' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await provider.send('device-1', 'Titre', 'Corps', {
      campaignId: 'c-1',
    });

    expect(result).toEqual({
      success: true,
      messageId: 'projects/nova-test/messages/m-1',
    });
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('projects/nova-test/messages:send');
    expect(options.headers).toMatchObject({
      Authorization: 'Bearer server-key-test',
    });
    const payload = JSON.parse(String(options.body)) as {
      message: { token: string; data: Record<string, string> };
    };
    expect(payload.message.token).toBe('device-1');
    expect(payload.message.data).toEqual({ campaignId: 'c-1' });
  });

  it('send retourne une erreur si la réponse HTTP est non-ok', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('UNAUTHENTICATED'),
    }) as unknown as typeof fetch;

    const result = await provider.send('device-1', 'Titre', 'Corps');

    expect(result.success).toBe(false);
    expect(result.error).toContain('FCM HTTP 401');
  });

  it('send échoue si FCM_SERVER_KEY est absent', async () => {
    delete process.env.FCM_SERVER_KEY;
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await provider.send('device-1', 'Titre', 'Corps');

    expect(result.success).toBe(false);
    expect(result.error).toContain('FCM_SERVER_KEY non configuré');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sendBatch compte les succès et les échecs', async () => {
    const sendSpy = jest
      .spyOn(provider, 'send')
      .mockResolvedValueOnce({ success: true, messageId: 'm-1' })
      .mockResolvedValueOnce({ success: false, error: 'boom' })
      .mockResolvedValueOnce({ success: true, messageId: 'm-2' });

    const result = await provider.sendBatch(
      ['d-1', 'd-2', 'd-3'],
      'Titre',
      'Corps',
    );

    expect(result).toEqual({ successCount: 2, failureCount: 1 });
    expect(sendSpy).toHaveBeenCalledTimes(3);
  });
});
