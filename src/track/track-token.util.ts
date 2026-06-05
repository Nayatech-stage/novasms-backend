import * as crypto from 'crypto';

const DEFAULT_TRACKING_SECRET = 'novasms-dev-tracking-secret';

export function getTrackingSecret(): string {
  return (
    process.env.TRACKING_TOKEN_SECRET ||
    process.env.JWT_SECRET ||
    DEFAULT_TRACKING_SECRET
  );
}

export function createTrackingToken(sendId: string): string {
  return crypto
    .createHmac('sha256', getTrackingSecret())
    .update(sendId)
    .digest('hex');
}

export function verifyTrackingToken(sendId: string, token?: string): boolean {
  if (!token) {
    return false;
  }

  const expected = createTrackingToken(sendId);

  if (expected.length !== token.length) {
    return false;
  }

  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token));
}

export function getTrackingBaseUrl(): string {
  const explicit = process.env.TRACKING_BASE_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/$/, '');
  }

  const appUrl = process.env.APP_BASE_URL?.trim();
  if (appUrl) {
    return `${appUrl.replace(/\/$/, '')}/api`;
  }

  const port = process.env.PORT || '3000';
  return `http://localhost:${port}/api`;
}
