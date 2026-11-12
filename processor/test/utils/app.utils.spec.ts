import { convertCentsToEur, eurToCents } from '../../src/utils/app.utils';
import { describe, expect, it } from '@jest/globals';

describe('test convertCentsToEur', () => {
  it('should return correct EUR amount', () => {
    expect(convertCentsToEur(10000, 2)).toBe(100);
  });
});

describe('test eurToCents', () => {
  it.each([
    [19.99, 1999],
    [0.29, 29],
    [10000, 1000000],
    [0, 0],
  ])('should convert %p EUR to %p cents', (eur, cents) => {
    expect(eurToCents(eur)).toBe(cents);
  });

  it('should follow Math.round for 1.005', () => {
    expect(eurToCents(1.005)).toBe(Math.round(1.005 * 100));
  });
});
