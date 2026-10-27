/**
 * Converts a cent amount to a formatted Euro string.
 * @param centAmount - the amount in cents
 * @param fractionDigits - the number of fraction digits to use (default is 2)
 * @returns the formatted Euro string
 */
export const convertCentsToEur = (centAmount: number, fractionDigits: number = 2): number => {
  return centAmount / Math.pow(10, fractionDigits);
};

/** Converts a EUR amount to cents, rounding to avoid float truncation (19.99 * 100 = 1998.9999...). */
export const eurToCents = (eur: number): number => Math.round(eur * 100);
