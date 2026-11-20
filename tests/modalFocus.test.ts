import { describe, expect, it, vi } from 'vitest';
import {
  activateModalDialog,
  getDialogFocusableElements,
  trapModalDialogKeydown,
} from '../src/app/modalFocus';

function fakeElement(options: { disabled?: boolean; ariaHidden?: string | null } = {}) {
  const attributes = new Map<string, string>();
  if (options.disabled) attributes.set('disabled', '');
  if (options.ariaHidden !== undefined && options.ariaHidden !== null) attributes.set('aria-hidden', options.ariaHidden);
  return {
    inert: false,
    isConnected: true,
    focus: vi.fn(),
    hasAttribute: (name: string) => attributes.has(name),
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    removeAttribute: (name: string) => attributes.delete(name),
    closest: () => null,
  };
}

function keyboardEvent(key: string, shiftKey = false) {
  let defaultPrevented = false;
  let propagationStopped = false;
  const event = {
    key,
    shiftKey,
    get defaultPrevented() { return defaultPrevented; },
    get propagationStopped() { return propagationStopped; },
    preventDefault() { defaultPrevented = true; },
    stopPropagation() { propagationStopped = true; },
  };
  return event as unknown as KeyboardEvent & { defaultPrevented: boolean; propagationStopped: boolean };
}

describe('accessible component deletion modal', () => {
  it('filters disabled and aria-hidden controls from the tab order', () => {
    const enabled = fakeElement();
    const disabled = fakeElement({ disabled: true });
    const hidden = fakeElement({ ariaHidden: 'true' });
    const dialog = { querySelectorAll: () => [enabled, disabled, hidden] } as unknown as HTMLElement;
    expect(getDialogFocusableElements(dialog)).toEqual([enabled]);
  });

  it('moves focus into the dialog, inerts the background, then restores prior state and return focus', () => {
    const outside = fakeElement();
    outside.inert = false;
    outside.setAttribute('aria-hidden', 'false');
    const host = fakeElement();
    const returnFocus = fakeElement();
    const initial = fakeElement();
    const dialog = {
      ownerDocument: { activeElement: null },
      querySelector: () => initial,
      querySelectorAll: () => [initial],
      contains: () => true,
    } as unknown as HTMLElement;
    const shell = {
      children: [outside, host],
      querySelector: () => null,
    } as unknown as HTMLElement;

    const restore = activateModalDialog(shell, host as unknown as HTMLElement, dialog,
      returnFocus as unknown as HTMLElement);

    expect(initial.focus).toHaveBeenCalledOnce();
    expect(outside.inert).toBe(true);
    expect(host.inert).toBe(false);
    expect(outside.getAttribute('aria-hidden')).toBe('true');
    restore();
    expect(outside.inert).toBe(false);
    expect(outside.getAttribute('aria-hidden')).toBe('false');
    expect(returnFocus.focus).toHaveBeenCalledOnce();
  });

  it('traps Tab and Shift+Tab at both ends of the modal', () => {
    const first = fakeElement();
    const last = fakeElement();
    const document = { activeElement: last };
    const dialog = {
      ownerDocument: document,
      querySelectorAll: () => [first, last],
      contains: (target: unknown) => target === first || target === last,
    } as unknown as HTMLElement;

    const forward = keyboardEvent('Tab');
    trapModalDialogKeydown(dialog, forward, () => undefined);
    expect(forward.defaultPrevented).toBe(true);
    expect(first.focus).toHaveBeenCalledOnce();

    document.activeElement = first;
    const backward = keyboardEvent('Tab', true);
    trapModalDialogKeydown(dialog, backward, () => undefined);
    expect(backward.defaultPrevented).toBe(true);
    expect(last.focus).toHaveBeenCalledOnce();
  });

  it('maps Escape to the safe Cancel callback', () => {
    const cancel = vi.fn();
    const dialog = {
      ownerDocument: { activeElement: null },
      querySelectorAll: () => [],
      contains: () => false,
      focus: vi.fn(),
    } as unknown as HTMLElement;
    const event = keyboardEvent('Escape');
    trapModalDialogKeydown(dialog, event, cancel);
    expect(cancel).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
    expect(event.propagationStopped).toBe(true);
  });

  it('does not let an empty dialog leak keyboard focus outside', () => {
    const focus = vi.fn();
    const dialog = {
      ownerDocument: { activeElement: null },
      querySelectorAll: () => [],
      contains: () => false,
      focus,
    } as unknown as HTMLElement;
    const event = keyboardEvent('Tab');
    trapModalDialogKeydown(dialog, event, () => undefined);
    expect(event.defaultPrevented).toBe(true);
    expect(focus).toHaveBeenCalledOnce();
  });
});
