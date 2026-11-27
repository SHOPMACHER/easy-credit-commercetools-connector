// easyCredit's elements are Stencil components loaded from easyCredit. These stand-ins render at once.
for (const tag of ['easycredit-express-button', 'easycredit-widget']) {
  customElements.define(
    tag,
    class extends HTMLElement {
      componentOnReady() {
        return Promise.resolve(this);
      }
    },
  );
}
