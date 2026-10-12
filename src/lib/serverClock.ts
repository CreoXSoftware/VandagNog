// The server's clock, as seen from this browser.
//
// Running timers are stamped by the database (start_time_entry uses now()), but
// the elapsed time is computed in the browser. If the PC clock is off — a few
// seconds is common on Windows — a timer starts at 0 and then jumps by the skew
// once the real row arrives. So elapsed time is measured against an estimate of
// the server's clock instead of Date.now().
//
// The offset is calibrated from round trips that create a server timestamp
// (see useStartTimer) and remembered across reloads.

import { useSyncExternalStore } from 'react';

const KEY = 'vn.serverClockOffset';

/** server time − local time, in ms. */
let offsetMs = load();

function load(): number {
  try {
    const v = Number(localStorage.getItem(KEY));
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

export function serverNow(): number {
  return Date.now() + offsetMs;
}

// `serverIso` was stamped by the server at some point between `sentAt` and
// `receivedAt` (local ms); the midpoint is the best guess, accurate to half the
// round trip.
export function calibrateServerClock(serverIso: string, sentAt: number, receivedAt: number): void {
  const server = Date.parse(serverIso);
  if (!Number.isFinite(server)) return;
  offsetMs = Math.round(server - (sentAt + receivedAt) / 2);
  try {
    localStorage.setItem(KEY, String(offsetMs));
  } catch {
    // Storage unavailable — the offset still applies for this session.
  }
}

// ----- Shared ticker ----------------------------------------------------------

// One interval for every running clock on screen. It ticks four times a second
// so the seconds digit flips within a quarter second of the real boundary,
// rather than up to a full second late with a 1 s interval started at an
// arbitrary moment.
const TICK_MS = 250;
let timer: number | null = null;
const listeners = new Set<() => void>();

// Read straight from the clock, floored to the tick so repeated reads within
// one render agree (useSyncExternalStore requires a stable snapshot). Never
// cached, so a clock that mounts mid-run doesn't paint a stale value first.
function snapshot(): number {
  return Math.floor(serverNow() / TICK_MS) * TICK_MS;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  if (timer == null) {
    timer = window.setInterval(() => {
      for (const l of listeners) l();
    }, TICK_MS);
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && timer != null) {
      window.clearInterval(timer);
      timer = null;
    }
  };
}

function noopSubscribe(): () => void {
  return () => {};
}

function zero(): number {
  return 0;
}

/** Server-time "now" that re-renders while `enabled`. */
export function useServerNow(enabled: boolean): number {
  return useSyncExternalStore(enabled ? subscribe : noopSubscribe, enabled ? snapshot : zero);
}
