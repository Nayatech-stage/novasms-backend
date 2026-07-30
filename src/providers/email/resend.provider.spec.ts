const mockSend = jest.fn();

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: mockSend },
  })),
}));

import { ResendProvider } from './resend.provider';

describe('ResendProvider — provider email principal (INTEG-01)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      RESEND_API_KEY: 're_test',
      RESEND_FROM: 'NovaSMS <no-reply@novasms.ci>',
    };
    delete process.env.RESEND_TEST_RECIPIENT;
    mockSend.mockResolvedValue({ data: { id: 'email-1' }, error: null });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('exige RESEND_API_KEY', () => {
    delete process.env.RESEND_API_KEY;

    expect(() => new ResendProvider()).toThrow('RESEND_API_KEY');
  });

  it('envoie avec l’expéditeur configuré', async () => {
    const result = await new ResendProvider().send(
      'client@x.ci',
      'Sujet',
      '<p>Corps</p>',
    );

    expect(result).toEqual({ success: true, messageId: 'email-1' });
    expect(mockSend).toHaveBeenCalledWith({
      from: 'NovaSMS <no-reply@novasms.ci>',
      to: ['client@x.ci'],
      subject: 'Sujet',
      html: '<p>Corps</p>',
    });
  });

  it('redirige vers RESEND_TEST_RECIPIENT en staging', async () => {
    process.env.RESEND_TEST_RECIPIENT = 'test@novasms.ci';

    await new ResendProvider().send('client@x.ci', 'S', '<p/>');

    expect(mockSend.mock.calls[0][0].to).toEqual(['test@novasms.ci']);
  });

  it('relaye l’erreur Resend sans lever', async () => {
    mockSend.mockResolvedValue({
      data: null,
      error: { message: 'Domain not verified' },
    });

    const result = await new ResendProvider().send('c@x.ci', 'S', '<p/>');

    expect(result).toEqual({ success: false, error: 'Domain not verified' });
  });

  it('capture les exceptions réseau', async () => {
    mockSend.mockRejectedValue(new Error('ENOTFOUND api.resend.com'));

    const result = await new ResendProvider().send('c@x.ci', 'S', '<p/>');

    expect(result.success).toBe(false);
    expect(result.error).toContain('ENOTFOUND');
  });

  it('sendBatch agrège succès et échecs', async () => {
    mockSend
      .mockResolvedValueOnce({ data: { id: 'a' }, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'bounce' } });

    const result = await new ResendProvider().sendBatch(
      [{ email: 'a@x.ci' }, { email: 'b@x.ci' }],
      'S',
      '<p/>',
    );

    expect(result).toEqual({ sent: 1, failed: 1 });
  });
});
