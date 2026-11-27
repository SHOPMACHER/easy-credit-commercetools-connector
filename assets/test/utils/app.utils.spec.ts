import { findElement, importEasyCreditScript } from '../../src/utils/app.utils';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

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

describe('findElement with an element', () => {
  it('should return the given element without a lookup', () => {
    const element = document.createElement('div');

    expect(findElement(element)).toBe(element);
  });
});

describe('waitForEasyCreditElement', () => {
  // A fresh module per test: the script state is kept per page.
  const loadUtils = () => {
    let utils: typeof import('../../src/utils/app.utils') | undefined;
    jest.isolateModules(() => {
      utils = jest.requireActual('../../src/utils/app.utils');
    });

    return utils!;
  };

  beforeEach(() => {
    document.head.innerHTML = '';
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should resolve ready once the component has rendered', async () => {
    const { waitForEasyCreditElement } = loadUtils();

    // easycredit-widget is defined with componentOnReady in jest.setup.ts.
    await expect(waitForEasyCreditElement(document.createElement('easycredit-widget'))).resolves.toBe('ready');
  });

  describe('with a shadow root that is still empty after componentOnReady', () => {
    // Like easyCredit's installment widget: it fills in when its rate request returns.
    customElements.define(
      'easycredit-test-late',
      class extends HTMLElement {
        constructor() {
          super();
          this.attachShadow({ mode: 'open' });
        }

        componentOnReady() {
          return Promise.resolve(this);
        }
      },
    );

    it('should resolve ready only once the shadow root has content', async () => {
      const { waitForEasyCreditElement } = loadUtils();
      const element = document.createElement('easycredit-test-late');
      let settled = false;

      const waiting = waitForEasyCreditElement(element).then((state) => {
        settled = true;

        return state;
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(settled).toBe(false);

      element.shadowRoot!.innerHTML = '<style>div{}</style>';
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(settled).toBe(false);

      element.shadowRoot!.innerHTML += '<div>Finanzieren ab 20,50 €</div>';

      await expect(waiting).resolves.toBe('ready');
    });

    it('should resolve timeout when the shadow root stays empty', async () => {
      jest.useFakeTimers();
      const { waitForEasyCreditElement, READY_TIMEOUT_MS } = loadUtils();

      const waiting = waitForEasyCreditElement(document.createElement('easycredit-test-late'));
      await Promise.resolve();
      jest.advanceTimersByTime(READY_TIMEOUT_MS);

      await expect(waiting).resolves.toBe('timeout');
    });
  });

  it('should resolve timeout when the component does not render in time', async () => {
    jest.useFakeTimers();
    const { waitForEasyCreditElement, READY_TIMEOUT_MS } = loadUtils();

    const waiting = waitForEasyCreditElement(document.createElement('easycredit-never-defined'));
    jest.advanceTimersByTime(READY_TIMEOUT_MS);

    await expect(waiting).resolves.toBe('timeout');
  });

  it('should resolve failed when the easyCredit script fails to load', async () => {
    const { importEasyCreditScript, waitForEasyCreditElement } = loadUtils();
    importEasyCreditScript();

    const waiting = waitForEasyCreditElement(document.createElement('easycredit-never-defined'));
    document.querySelector('script#easy-credit')?.dispatchEvent(new Event('error'));

    await expect(waiting).resolves.toBe('failed');
  });
});
