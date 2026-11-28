const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function getDialogFocusableElements(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((element) =>
      !element.hasAttribute('disabled') &&
      element.getAttribute('aria-hidden') !== 'true' &&
      !element.closest('[inert]'),
    );
}

/** Makes every app-shell sibling except the modal host inert, then restores exact prior state. */
export function inertDialogBackground(shell: HTMLElement, modalHost: HTMLElement): () => void {
  const previous = Array.from(shell.children)
    .filter((child) => child !== modalHost)
    .map((child) => {
      const element = child as HTMLElement;
      return {
        element,
        inert: element.inert,
        ariaHidden: element.getAttribute('aria-hidden'),
      };
    });

  for (const item of previous) {
    item.element.inert = true;
    item.element.setAttribute('aria-hidden', 'true');
  }

  return () => {
    for (const item of previous) {
      item.element.inert = item.inert;
      if (item.ariaHidden === null) item.element.removeAttribute('aria-hidden');
      else item.element.setAttribute('aria-hidden', item.ariaHidden);
    }
  };
}

export function activateModalDialog(
  shell: HTMLElement,
  modalHost: HTMLElement,
  dialog: HTMLElement,
  returnFocus: HTMLElement | null,
): () => void {
  const restoreBackground = inertDialogBackground(shell, modalHost);
  const initialTarget =
    dialog.querySelector<HTMLElement>('[data-dialog-initial-focus]') ??
    getDialogFocusableElements(dialog)[0] ??
    dialog;
  initialTarget.focus({ preventScroll: true });

  return () => {
    restoreBackground();
    const fallback = shell.querySelector<HTMLElement>('.component-rack-close');
    const target = returnFocus?.isConnected ? returnFocus : fallback;
    target?.focus({ preventScroll: true });
  };
}

/** Routes Escape to safe cancellation and traps forward/backward Tab navigation. */
export function trapModalDialogKeydown(
  dialog: HTMLElement,
  event: KeyboardEvent,
  onEscape: () => void,
): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    onEscape();
    return;
  }
  if (event.key !== 'Tab') return;

  const focusable = getDialogFocusableElements(dialog);
  if (focusable.length === 0) {
    event.preventDefault();
    dialog.focus({ preventScroll: true });
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = dialog.ownerDocument.activeElement;
  const outside = active === null || !dialog.contains(active);

  if (event.shiftKey && (active === first || outside)) {
    event.preventDefault();
    last.focus({ preventScroll: true });
  } else if (!event.shiftKey && (active === last || outside)) {
    event.preventDefault();
    first.focus({ preventScroll: true });
  }
}
