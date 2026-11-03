import { createHmac, timingSafeEqual } from 'crypto';
import { readConfiguration } from './config.utils';

const KEY_LABEL = 'easycredit-connector/webhook-redirect-url/v1';

// Derived from the easyCredit API password, so no extra secret has to be configured.
const signingKey = (): Buffer =>
  createHmac('sha256', readConfiguration().easyCredit.apiPassword).update(KEY_LABEL).digest();

// Binds the redirect target to the payment, so a link signed for one payment cannot be reused for another.
export const signRedirectUrl = (paymentId: string, redirectUrl: string): string =>
  createHmac('sha256', signingKey()).update(`${paymentId}\n${redirectUrl}`).digest('base64url');

export const isRedirectUrlSigned = (paymentId: string, redirectUrl: string, signature: string | undefined): boolean => {
  if (!signature) {
    return false;
  }

  const expected = Buffer.from(signRedirectUrl(paymentId, redirectUrl));
  const actual = Buffer.from(signature);

  return expected.length === actual.length && timingSafeEqual(expected, actual);
};
