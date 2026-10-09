// Platform-specific modifier handling for the app's keyboard shortcuts.
//
// The quick-edit shortcuts are Alt+<key> on Windows/Linux and ⌘+<key> on macOS.
// On a Mac, ⌥ (Option) is accepted as well: Chrome reserves ⌘T for "new tab"
// and never delivers it to the page, so ⌥T is the way through there.

export const isMac: boolean =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad|iPod/i.test(
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
      navigator.platform ??
      navigator.userAgent,
  );

/** Label for the shortcut modifier: "⌘" on macOS, "Alt" elsewhere. */
export const modLabel = isMac ? '⌘' : 'Alt';

export type QuickKey = 'd' | 'a' | 't';

// Matches on e.code, not e.key: Option+D on a Mac types "∂", and non-QWERTY
// layouts would otherwise miss. Ctrl is excluded so AltGr (reported as
// Ctrl+Alt on Windows) still types characters like "@" normally.
export function quickKeyOf(e: Pick<KeyboardEvent, 'code' | 'altKey' | 'metaKey' | 'ctrlKey' | 'shiftKey'>): QuickKey | null {
  if (e.ctrlKey || e.shiftKey) return null;
  const mod = isMac ? e.metaKey || e.altKey : e.altKey && !e.metaKey;
  if (!mod) return null;
  if (e.code === 'KeyD') return 'd';
  if (e.code === 'KeyA') return 'a';
  if (e.code === 'KeyT') return 't';
  return null;
}
