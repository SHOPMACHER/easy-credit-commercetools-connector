/**
 * Converts a cent amount to a formatted Euro string.
 * @param centAmount - the amount in cents
 * @param fractionDigits - the number of fraction digits to use (default is 2)
 * @returns the formatted Euro string
 */
export const convertCentsToEur = (centAmount: number, fractionDigits: number = 2): number => {
  return centAmount / Math.pow(10, fractionDigits);
};
