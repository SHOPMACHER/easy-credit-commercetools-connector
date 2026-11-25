import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  EASYCREDIT_ALERT_TEXT,
  resetEasyCreditAlertFilter,
  suppressEasyCreditAlert,
} from '../../src/utils/easycredit-alert.utils';

describe('suppressEasyCreditAlert', () => {
  let native: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    native = jest.fn();
    window.alert = native;
  });

  afterEach(() => {
    resetEasyCreditAlertFilter();
    jest.useRealTimers();
  });

  it('swallows the easyCredit text inside the window', () => {
    suppressEasyCreditAlert();
    window.alert(EASYCREDIT_ALERT_TEXT);
    expect(native).not.toHaveBeenCalled();
  });

  it('passes other texts through', () => {
    suppressEasyCreditAlert();
    window.alert('Shop message');
    expect(native).toHaveBeenCalledWith('Shop message');
  });

  it('restores the original after the window', () => {
    suppressEasyCreditAlert();
    jest.advanceTimersByTime(11_000);
    expect(window.alert).toBe(native);
  });

  it('extends the window on a second call', () => {
    suppressEasyCreditAlert();
    jest.advanceTimersByTime(8_000);
    suppressEasyCreditAlert();
    jest.advanceTimersByTime(8_000);
    window.alert(EASYCREDIT_ALERT_TEXT);
    expect(native).not.toHaveBeenCalled();
    jest.advanceTimersByTime(3_000);
    expect(window.alert).toBe(native);
  });

  it('wraps once for any number of callers', () => {
    suppressEasyCreditAlert();
    const wrapper = window.alert;
    suppressEasyCreditAlert();
    expect(window.alert).toBe(wrapper);
  });

  it('does not overwrite an alert another script set meanwhile', () => {
    suppressEasyCreditAlert();
    const other = jest.fn();
    window.alert = other;
    jest.advanceTimersByTime(11_000);
    expect(window.alert).toBe(other);
  });

  it('wraps the current alert, not a stale original, in a later window', () => {
    suppressEasyCreditAlert();
    const other = jest.fn();
    window.alert = other;
    jest.advanceTimersByTime(11_000);
    suppressEasyCreditAlert();
    window.alert('Shop message');
    expect(other).toHaveBeenCalledWith('Shop message');
    expect(native).not.toHaveBeenCalled();
  });

  it('keeps this for the original alert', () => {
    suppressEasyCreditAlert();
    window.alert('Shop message');
    expect(native.mock.contexts[0]).toBe(window);
  });

  it('does not let a stale timer end a newer window', () => {
    suppressEasyCreditAlert();
    window.alert = jest.fn();
    jest.advanceTimersByTime(5_000);
    suppressEasyCreditAlert();
    const wrapper = window.alert;
    jest.advanceTimersByTime(6_000);
    expect(window.alert).toBe(wrapper);
  });
});
