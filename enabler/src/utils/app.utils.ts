export const importEasyCreditScript = () => {
  const currentScript = document.querySelectorAll('script#easycredit-webcomponents');

  if (currentScript.length === 0) {
    const g = document.createElement('script');
    g.setAttribute('id', 'easycredit-webcomponents');
    
    const s = document.getElementsByTagName('script')[0];
    g.type = "module";
    g.src = "https://ratenkauf.easycredit.de/api/resource/webcomponents/v3/easycredit-components/easycredit-components.esm.js"
    s.parentNode.insertBefore(g, s);
  }
}