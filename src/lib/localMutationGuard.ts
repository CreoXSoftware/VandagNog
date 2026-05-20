let lastAt = 0;

export function markLocalWorkItemMutation() {
  lastAt = Date.now();
}

export function recentLocalWorkItemMutation(windowMs = 1500): boolean {
  return Date.now() - lastAt < windowMs;
}
