export type ShortcutPlatform = 'mac' | 'standard';

export function detectShortcutPlatform(
  navigatorLike?: Pick<Navigator, 'platform' | 'userAgent'> | null,
): ShortcutPlatform {
  const nav = navigatorLike ?? (typeof navigator !== 'undefined' ? navigator : null);
  if (!nav) return 'standard';
  const raw = `${nav.platform ?? ''} ${nav.userAgent ?? ''}`.toLowerCase();
  return /mac|iphone|ipad|ipod/.test(raw) ? 'mac' : 'standard';
}

const STANDARD_KEY_LABELS: Readonly<Record<string, string>> = {
  Mod: 'Ctrl',
  Ctrl: 'Ctrl',
  Alt: 'Alt',
  Shift: 'Shift',
  Enter: 'Enter',
  Esc: 'Esc',
  Backspace: 'Backspace',
  Delete: 'Del',
  Space: 'Space',
  Tab: 'Tab',
  Home: 'Home',
  End: 'End',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Arrows: '← ↑ ↓ →',
};

const MAC_KEY_LABELS: Readonly<Record<string, string>> = {
  Mod: '⌘',
  Ctrl: '⌃',
  Alt: '⌥',
  Shift: '⇧',
  Enter: '↩',
  Esc: 'Esc',
  Backspace: '⌫',
  Delete: '⌦',
  Space: 'Space',
  Tab: '⇥',
  Home: 'Home',
  End: 'End',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Arrows: '← ↑ ↓ →',
};

export function formatKeyTokenForPlatform(token: string, platform: ShortcutPlatform): string {
  const map = platform === 'mac' ? MAC_KEY_LABELS : STANDARD_KEY_LABELS;
  return map[token] ?? token;
}

export function formatKeyComboForPlatform(
  tokens: readonly string[],
  platform: ShortcutPlatform,
): string[] {
  return tokens.map((token) => formatKeyTokenForPlatform(token, platform));
}
