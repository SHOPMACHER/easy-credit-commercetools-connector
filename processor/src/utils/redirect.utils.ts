import { createHmac, timingSafeEqual } from 'crypto';
import { readConfiguration } from './config.utils';

// Binds the shop redirect URLs to one payment so the public webhook routes can't be used as an open redirect.
// JSON keeps the parts unambiguous, so the boundary between the URLs can't be shifted.
export const signRedirectUrl = (paymentId: string, redirectUrl: string, successUrl?: string): string =>
  createHmac('sha256', readConfiguration().easyCredit.apiPassword)
    .update(JSON.stringify([paymentId, redirectUrl, successUrl ?? null]))
    .digest('hex');

export const isValidRedirectSignature = (
  paymentId: string,
  redirectUrl: string,
  successUrl: string | undefined,
  signature?: string,
): boolean => {
  const expected = Buffer.from(signRedirectUrl(paymentId, redirectUrl, successUrl));
  const actual = Buffer.from(signature ?? '');

  return expected.length === actual.length && timingSafeEqual(expected, actual);
};
