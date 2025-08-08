import {
  array,
  getValidateMessages,
  optional,
  region,
  standardBoolean,
  standardEmail,
  standardKey,
  standardNaturalNumber,
  standardString,
  standardUrl,
} from '../../src/validators/helpers.validators';

describe('Validation Helpers', () => {
  describe('standardString', () => {
    const message = {
      code: 'InvalidName',
      message: 'Invalid name',
      referencedBy: 'test',
    };

    it('should validate a string with valid length', () => {
      const [path, validators] = standardString(['name'], message);
      const validate = getValidateMessages([[path, validators]], { name: 'John' });
      expect(validate).toHaveLength(0);
    });

    it('should return an error message for a string with invalid length', () => {
      const [path, validators] = standardString(['name'], message);
      const validate = getValidateMessages([[path, validators]], { name: 'A' });
      expect(validate).toEqual([message]);
    });
  });

  describe('standardEmail', () => {
    const message = {
      code: 'Invalid email',
      message: 'Invalid email',
      referencedBy: 'test',
    };

    it('should validate a valid email', () => {
      const [path, validators] = standardEmail(['email'], message);
      const validate = getValidateMessages([[path, validators]], { email: 'test@example.com' });
      expect(validate).toHaveLength(0);
    });

    it('should return an error message for an invalid email', () => {
      const [path, validators] = standardEmail(['email'], message);
      const validate = getValidateMessages([[path, validators]], { email: 'invalid-email' });
      expect(validate).toEqual([message]);
    });
  });

  describe('standardNaturalNumber', () => {
    const message = {
      code: 'Invalid age',
      message: 'Invalid age',
      referencedBy: 'test',
    };

    it('should validate a natural number', () => {
      const [path, validators] = standardNaturalNumber(['age'], message);
      const validate = getValidateMessages([[path, validators]], { age: '25' });
      expect(validate).toHaveLength(0);
    });

    it('should return an error message for a non-natural number', () => {
      const [path, validators] = standardNaturalNumber(['age'], message);
      const validate = getValidateMessages([[path, validators]], { age: '25.5' });
      expect(validate).toEqual([message]);
    });
  });

  describe('standardKey', () => {
    const message = {
      code: 'Invalid key',
      message: 'Invalid key',
      referencedBy: 'test',
    };

    it('should validate a valid key', () => {
      const [path, validators] = standardKey(['key'], message);
      const validate = getValidateMessages([[path, validators]], { key: 'valid-key-123' });
      expect(validate).toHaveLength(0);
    });

    it('should return an error message for an invalid key', () => {
      const [path, validators] = standardKey(['key'], message);
      const validate = getValidateMessages([[path, validators]], { key: 'invalid key!' });
      expect(validate).toEqual([message]);
    });
  });

  describe('standardUrl', () => {
    const message = {
      code: 'Invalid URL',
      message: 'Invalid URL',
      referencedBy: 'test',
    };

    it('should validate a valid URL', () => {
      const [path, validators] = standardUrl(['website'], message);
      const validate = getValidateMessages([[path, validators]], { website: 'https://example.com' });
      expect(validate).toHaveLength(0);
    });

    it('should return an error message for an invalid URL', () => {
      const [path, validators] = standardUrl(['website'], message);
      const validate = getValidateMessages([[path, validators]], { website: 'invalid-url' });
      expect(validate).toEqual([message]);
    });
  });

  describe('standardBoolean', () => {
    const message = {
      code: 'Invalid boolean',
      message: 'Invalid boolean',
      referencedBy: 'test',
    };

    it('should validate a boolean value', () => {
      const [path, validators] = standardBoolean(['isActive'], message);
      const validate = getValidateMessages([[path, validators]], { isActive: true });
      expect(validate).toHaveLength(0);
    });

    it('should return an error message for a non-boolean value', () => {
      const [path, validators] = standardBoolean(['isActive'], message);
      const validate = getValidateMessages([[path, validators]], { isActive: 'truee' });
      expect(validate).toEqual([message]);
    });
  });

  describe('getValidateMessages', () => {
    const nameMessage = {
      code: 'Invalid name',
      message: 'Invalid name',
      referencedBy: 'test',
    };

    const emailMessage = {
      code: 'Invalid email',
      message: 'Invalid email',
      referencedBy: 'test',
    };

    it('should return messages for invalid values', () => {
      const configs = [standardString(['name'], nameMessage), standardEmail(['email'], emailMessage)];
      const result = getValidateMessages(configs, { name: 'A', email: 'invalid-email' });
      expect(result).toEqual([nameMessage, emailMessage]);
    });

    it('should return an empty array for valid values', () => {
      const configs = [standardString(['name'], nameMessage), standardEmail(['email'], emailMessage)];
      const result = getValidateMessages(configs, { name: 'John', email: 'test@example.com' });
      expect(result).toHaveLength(0);
    });
  });

  describe('optional', () => {
    const message = {
      code: 'Invalid name',
      message: 'Invalid name',
      referencedBy: 'test',
    };

    it('should return true for undefined value', () => {
      const [path, validators] = optional(standardString)(['name'], message);
      const validate = getValidateMessages([[path, validators]], { name: undefined });
      expect(validate).toHaveLength(0);
    });

    it('should validate a valid value', () => {
      const [path, validators] = optional(standardString)(['name'], message);
      const validate = getValidateMessages([[path, validators]], { name: 'John' });
      expect(validate).toHaveLength(0);
    });

    it('should return an error for an invalid value', () => {
      const [path, validators] = optional(standardString)(['name'], message);
      const validate = getValidateMessages([[path, validators]], { name: 'A' });
      expect(validate).toEqual([message]);
    });
  });

  describe('array', () => {
    const message = {
      code: 'Invalid age',
      message: 'Invalid age',
      referencedBy: 'test',
    };

    it('should validate an array of valid items', () => {
      const [path, validators] = array(standardNaturalNumber)(['ages'], message);
      const validate = getValidateMessages([[path, validators]], { ages: ['25', '30'] });
      expect(validate).toHaveLength(0);
    });

    it('should return an error for invalid items in array', () => {
      const [path, validators] = array(standardNaturalNumber)(['ages'], message);
      const validate = getValidateMessages([[path, validators]], { ages: ['25', 'invalid'] });
      expect(validate).toEqual([message]);
    });
  });

  describe('region', () => {
    const message = {
      code: 'Invalid region',
      message: 'Invalid region',
      referencedBy: 'test',
    };

    it('should validate a valid region', () => {
      const [path, validators] = region(['region'], message);
      const validate = getValidateMessages([[path, validators]], { region: 'us-central1.gcp' });
      expect(validate).toHaveLength(0);
    });

    it('should return an error for an invalid region', () => {
      const [path, validators] = region(['region'], message);
      const validate = getValidateMessages([[path, validators]], { region: 'invalid-region' });
      expect(validate).toEqual([message]);
    });
  });
});
