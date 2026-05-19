import type { ProjectMember } from '@/types/db';

export interface DisplayUser {
  first_name?: string | null;
  last_name?: string | null;
  display_name?: string | null;
  email?: string | null;
  user_id?: string;
}

function emailLocal(email?: string | null): string | null {
  if (!email) return null;
  const at = email.indexOf('@');
  return at > 0 ? email.slice(0, at) : email;
}

export function displayName(u: DisplayUser | null | undefined): string {
  if (!u) return 'Unknown';
  const full = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
  if (full) return full;
  if (u.display_name && u.display_name.trim()) return u.display_name.trim();
  const local = emailLocal(u.email);
  if (local) return local;
  if (u.user_id) return u.user_id.slice(0, 8);
  return 'Unknown';
}

export function initials(u: DisplayUser | null | undefined): string {
  if (!u) return '??';
  const f = (u.first_name ?? '').trim();
  const l = (u.last_name ?? '').trim();
  if (f && l) return (f[0] + l[0]).toUpperCase();
  if (f) return (f.slice(0, 2)).toUpperCase();
  if (l) return (l.slice(0, 2)).toUpperCase();
  const dn = (u.display_name ?? '').trim();
  if (dn) {
    const parts = dn.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return parts[0].slice(0, 2).toUpperCase();
  }
  const local = emailLocal(u.email);
  if (local) {
    const parts = local.split(/[._\-]/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return local.slice(0, 2).toUpperCase();
  }
  return '??';
}

export function memberDisplay(m: ProjectMember | undefined | null): string {
  return displayName(m ?? undefined);
}

export function memberInitials(m: ProjectMember | undefined | null): string {
  return initials(m ?? undefined);
}

// Deterministic hue from a stable id, for avatar background tinting.
export function avatarHue(seed?: string | null): number {
  if (!seed) return 220;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % 360;
}
