export function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just nu';
  if (s < 3600) return `${Math.floor(s / 60)} min sedan`;
  if (s < 86400) return `${Math.floor(s / 3600)} h sedan`;
  if (s < 604800) return `${Math.floor(s / 86400)} d sedan`;
  return new Date(iso).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' });
}
export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
}
export function initials(name: string): string {
  return (name || '?').replace(/[^a-zA-Z0-9åäöÅÄÖ]/g, '').slice(0, 2).toUpperCase() || '?';
}
export function hueFromId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}
export function isOnline(p: { show_online?: boolean; last_seen_at?: string | null }): boolean {
  if (!p.show_online || !p.last_seen_at) return false;
  return Date.now() - new Date(p.last_seen_at).getTime() < 5 * 60 * 1000;
}
export function uid(): string {
  return crypto.randomUUID();
}
export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
