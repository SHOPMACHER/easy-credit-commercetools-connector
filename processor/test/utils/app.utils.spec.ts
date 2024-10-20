import { convertCentsToEur } from './../../src/utils/app.utils';
import { describe, expect, it } from '@jest/globals';

describe('test convertCentsToEur', () => {
  it('should return correct EUR amount', () => {
    expect(convertCentsToEur(10000, 2)).toBe(100);
  });
});
