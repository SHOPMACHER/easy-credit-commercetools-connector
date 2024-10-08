export const importEasyCreditScript = () => {
  const currentScript = document.querySelectorAll('script#easycredit-webcomponents');

  if (currentScript.length === 0) {
    const g = document.createElement('script');
    g.setAttribute('id', 'easycredit-webcomponents');
    g.type = 'module';
    g.src =
      'https://ratenkauf.easycredit.de/api/resource/webcomponents/v3/easycredit-components/easycredit-components.esm.js';

    const s = document.getElementsByTagName('script')[0];

    if (s && s.parentNode) {
      s.parentNode.insertBefore(g, s);
    }
  }
};

export const findElement = (selector: string) => {
  const element = document.querySelector(selector);

  if (element === null) {
    throw new Error(`Element not found: ${selector}`);
  }

  return element;
};
