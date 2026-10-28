/**
 * Full page load instead of client routing. Used when the session changes
 * (login, logout, expiry) so no cached data of another session stays in memory.
 */
export function hardNavigate(path: string): void {
  window.location.assign(path);
}
