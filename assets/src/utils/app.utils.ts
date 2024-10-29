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

  document.head.appendChild(g);
};

export const findElement = (selector: string): Element => {
  const element = document.querySelector(selector);

  if (!element) {
    throw new Error(`Element not found: ${selector}`);
  }

  return element;
};
