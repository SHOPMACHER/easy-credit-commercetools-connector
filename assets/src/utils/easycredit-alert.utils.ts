// easyCredit's express button (v3 bundle, read 2026-11-25) starts a 10 s timer on every modal accept,
// before it fires `easycredit-submit`. The timer then calls the global alert() and only `beforeunload`
// clears it, so we can't cancel it. We swallow exactly that text for a while after the latest submit.
// Remove once easyCredit offers a way to cancel the alert.
export const EASYCREDIT_ALERT_TEXT =
  'Leider ist eine Zahlung mit easyCredit derzeit nicht möglich. Bitte verwenden Sie eine andere Zahlungsart oder wenden Sie sich an den Händler.';
// 10 s timer plus a margin.
export const EASYCREDIT_ALERT_WINDOW_MS = 11_000;

type State = { original: typeof window.alert; wrapper: typeof window.alert; timer: number };
let state: State | undefined;

// Also exported for tests only.
export function resetEasyCreditAlertFilter(): void {
  if (!state) return;
  window.clearTimeout(state.timer);
  // Another script may have replaced window.alert meanwhile; leave that one alone.
  if (window.alert === state.wrapper) window.alert = state.original;
  state = undefined;
}

// One wrapper for every caller on the page; each call pushes the end of the window out.
export function suppressEasyCreditAlert(): void {
  if (state && window.alert !== state.wrapper) resetEasyCreditAlertFilter(); // replaced mid-window: wrap the new one
  if (!state) {
    const original = window.alert;
    const wrapper = function (this: unknown, ...args: unknown[]) {
      if (args[0] === EASYCREDIT_ALERT_TEXT) return;
      return (original as (...a: unknown[]) => unknown).apply(this, args);
    } as typeof window.alert;
    window.alert = wrapper;
    state = { original, wrapper, timer: 0 };
  }
  window.clearTimeout(state.timer);
  state.timer = window.setTimeout(resetEasyCreditAlertFilter, EASYCREDIT_ALERT_WINDOW_MS);
}
