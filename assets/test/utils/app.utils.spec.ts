import { findElement, importEasyCreditScript } from '../../src/utils/app.utils';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

describe('importEasyCreditScript', () => {
  beforeEach(() => {
    // Clear the document before each test
    document.head.innerHTML = '';
    jest.clearAllMocks();
  });

  it('should append the EasyCredit script if it does not exist', () => {
    // Call the function to import the script
    importEasyCreditScript();

    const script = document.querySelector('script#easy-credit');

    // Assert that the script element has been appended
    expect(script).toBeTruthy();
    expect(script?.getAttribute('src')).toBe(
      'https://ratenkauf.easycredit.de/api/resource/webcomponents/v3/easycredit-components/easycredit-components.esm.js',
    );
    expect(script?.getAttribute('type')).toBe('module');
  });

  it('should not append the script if it already exists', () => {
    // Pre-add a script element to the document
    const existingScript = document.createElement('script');
    existingScript.setAttribute('id', 'easy-credit');
    document.head.appendChild(existingScript);

    // Spy on document.createElement to check if a new script is created
    const createElementSpy = jest.spyOn(document, 'createElement');

    // Call the function
    importEasyCreditScript();

    // Assert that the new script is not appended
    expect(createElementSpy).not.toHaveBeenCalled();
    expect(document.querySelectorAll('script#easy-credit').length).toBe(1);
  });
});

describe('findElement', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    jest.clearAllMocks();
  });

  it('should return the element if it exists', () => {
    // Set up a DOM element
    const div = document.createElement('div');
    div.setAttribute('id', 'test-element');
    document.body.appendChild(div);

    // Find the element
    const element = findElement('#test-element');

    // Assert the element is returned
    expect(element).toBe(div);
  });

  it('should throw an error if the element does not exist', () => {
    // Try finding a non-existent element
    expect(() => findElement('#non-existent')).toThrow('Element not found: #non-existent');
  });
});
