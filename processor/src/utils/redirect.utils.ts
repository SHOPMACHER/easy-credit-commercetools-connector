import { createHmac, timingSafeEqual } from 'crypto';
import { readConfiguration } from './config.utils';

// Binds a shop redirect URL to one payment so the public webhook routes can't be used as an open redirect.
export const signRedirectUrl = (paymentId: string, redirectUrl: string): string =>
  createHmac('sha256', readConfiguration().easyCredit.apiPassword).update(`${paymentId}:${redirectUrl}`).digest('hex');

export const isValidRedirectSignature = (paymentId: string, redirectUrl: string, signature?: string): boolean => {
  const expected = Buffer.from(signRedirectUrl(paymentId, redirectUrl));
  const actual = Buffer.from(signature ?? '');

  return expected.length === actual.length && timingSafeEqual(expected, actual);
};
