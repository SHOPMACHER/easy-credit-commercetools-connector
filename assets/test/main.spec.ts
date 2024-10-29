import { Enabler } from '../src/main'; // Adjust the path as necessary
import { ECWebComponent } from '../src/ec-web-component';
import { describe, it, expect } from '@jest/globals';

describe('Enabler Export', () => {
  it('should export ECWebComponent as Enabler', () => {
    expect(Enabler).toBe(ECWebComponent);
  });
});
