// Settles when the easyCredit script fails to load (CSP, ad blocker, outage). Kept for the page, because a second
// import finds the script tag and never sees its error event.
let scriptFailed: Promise<void> = new Promise(() => {});

export const importEasyCreditScript = () => {
  const script = document.querySelector('script#easy-credit');

  if (script) {
    return;
  }

  const g = document.createElement('script');
  g.setAttribute('id', 'easy-credit');
  g.type = 'module';
  g.src =
    'https://ratenkauf.easycredit.de/api/resource/webcomponents/v3/easycredit-components/easycredit-components.esm.js';
  scriptFailed = new Promise((resolve) => g.addEventListener('error', () => resolve(), { once: true }));

  document.head.appendChild(g);
};

export const findElement = (selector: string | Element): Element => {
  if (typeof selector !== 'string') {
    return selector;
  }

  const element = document.querySelector(selector);

  if (!element) {
    throw new Error(`Element not found: ${selector}`);
  }

  return element;
};

export const READY_TIMEOUT_MS = 5000;

type ReadyState = 'ready' | 'failed' | 'timeout';

type StencilElement = HTMLElement & { componentOnReady?: () => Promise<unknown> };

const hasContent = (root: ShadowRoot): boolean =>
  Array.from(root.children).some((child) => child.localName !== 'style');

// easyCredit's elements are Stencil components: they render after their script has loaded and defined them.
// 'ready': the element has rendered. 'failed': the easyCredit script did not load, so the element never renders.
// 'timeout': still not rendered after READY_TIMEOUT_MS. On a slow connection it still renders when the script arrives.
export const waitForEasyCreditElement = async (element: HTMLElement): Promise<ReadyState> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let observer: MutationObserver | undefined;
  const timeout = new Promise<ReadyState>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), READY_TIMEOUT_MS);
  });
  const ready = customElements
    .whenDefined(element.localName)
    .then(() => (element as StencilElement).componentOnReady?.())
    // The installment widget is still empty then: it fills in when easyCredit's rate request returns.
    .then(
      () =>
        new Promise<void>((resolve) => {
          const root = element.shadowRoot;
          if (!root || hasContent(root)) {
            resolve();

            return;
          }
          observer = new MutationObserver(() => hasContent(root) && resolve());
          observer.observe(root, { childList: true, subtree: true });
        }),
    )
    // A rejected componentOnReady still leaves a defined element on the page: show it.
    .then(
      (): ReadyState => 'ready',
      (): ReadyState => 'ready',
    );
  const failed = scriptFailed.then((): ReadyState => 'failed');

  try {
    return await Promise.race([ready, failed, timeout]);
  } finally {
    clearTimeout(timer);
    observer?.disconnect();
  }
};
