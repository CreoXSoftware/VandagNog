// Platform-specific modifier handling for the app's keyboard shortcuts.
//
// The quick-edit shortcuts are Alt+<key> on Windows/Linux and ⌘+<key> on macOS.
// On a Mac, ⌥ (Option) is accepted as well: Chrome keeps ⌘N ("new window")
// and ⌘L (address bar) for itself, so ⌥N and ⌥L are the way through there.

export const isMac: boolean =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad|iPod/i.test(
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
      navigator.platform ??
      navigator.userAgent,
  );

/** Label for the shortcut modifier: "⌘" on macOS, "Alt" elsewhere. */
export const modLabel = isMac ? '⌘' : 'Alt';

/** The Tasks page quick edits. */
export type QuickKey = 'note' | 'assign' | 'duration' | 'end';

// The letter for each, with the modifier. Picked to stay clear of the
// browsers' own Alt+letter shortcuts: D (address bar), E and F (Chrome/Edge
// menu, Firefox Edit/File), and Firefox's V, S, B, T and H menus.
export const QUICK_KEYS: Record<QuickKey, string> = {
  note: 'N', // the description
  assign: 'A',
  duration: 'L', // length
  end: 'U', // until
};

/** "Alt+L" / "⌘L"-style label for a quick edit's shortcut. */
export function quickLabel(k: QuickKey): string {
  return `${modLabel}+${QUICK_KEYS[k]}`;
}

const QUICK_BY_CODE = new Map(
  (Object.keys(QUICK_KEYS) as QuickKey[]).map((k) => [`Key${QUICK_KEYS[k]}`, k]),
);

// Matches on e.code, not e.key: Option+N on a Mac types a dead key, and
// non-QWERTY layouts would otherwise miss. Ctrl is excluded so AltGr (reported
// as Ctrl+Alt on Windows) still types characters like "@" normally.
export function quickKeyOf(e: Pick<KeyboardEvent, 'code' | 'altKey' | 'metaKey' | 'ctrlKey' | 'shiftKey'>): QuickKey | null {
  if (e.ctrlKey || e.shiftKey) return null;
  const mod = isMac ? e.metaKey || e.altKey : e.altKey && !e.metaKey;
  if (!mod) return null;
  return QUICK_BY_CODE.get(e.code) ?? null;
}
