// Architecture for additional languages. Swedish is the initial (and complete)
// locale; English is a partial fallback used when a user switches locale.
export type Locale = 'sv' | 'en';
const sv: Record<string, string> = {
  discover: 'Upptäck', chat: 'Chatt', communities: 'Communities', notifications: 'Notiser', profile: 'Profil',
  safety: 'Säkerhetscenter', settings: 'Inställningar', admin: 'Moderatorpanel',
  tagline: 'Connect. Talk. Belong.', send: 'Skicka', cancel: 'Avbryt', save: 'Spara',
  loading: 'Laddar…', empty: 'Inget att visa ännu', error: 'Något gick fel', retry: 'Försök igen',
  report: 'Rapportera', block: 'Blockera', join: 'Gå med', leave: 'Lämna', create: 'Skapa',
  back: 'Tillbaka', search: 'Sök', all: 'Alla', online: 'Online', demo: 'Demo',
};
const en: Record<string, string> = {
  discover: 'Discover', chat: 'Chat', communities: 'Communities', notifications: 'Alerts', profile: 'Profile',
  safety: 'Safety Center', settings: 'Settings', admin: 'Moderator panel',
  tagline: 'Connect. Talk. Belong.', send: 'Send', cancel: 'Cancel', save: 'Save',
  loading: 'Loading…', empty: 'Nothing here yet', error: 'Something went wrong', retry: 'Try again',
  report: 'Report', block: 'Block', join: 'Join', leave: 'Leave', create: 'Create',
  back: 'Back', search: 'Search', all: 'All', online: 'Online', demo: 'Demo',
};
export function t(key: string, locale: Locale = 'sv'): string {
  const table = locale === 'en' ? en : sv;
  return table[key] ?? sv[key] ?? key;
}
export const CATEGORY_LABELS: Record<string, string> = {
  none: 'Ingen överträdelse', bullying: 'Mobbning / trakasserier', threat: 'Hot / våld',
  hate: 'Hets / diskriminering', sexual_harassment: 'Sexuella trakasserier',
  sexual_minors: 'Innehåll som rör minderåriga', grooming: 'Grooming / manipulation',
  pii: 'Privata uppgifter', external_platform: 'Extern plattform', scam: 'Bedrägeri',
  spam: 'Spam', dangerous_challenge: 'Farlig utmaning', evasion: 'Kringgående',
  context: 'Kontextberoende mönster', multimodal: 'Bild / röst', external_ai: 'Extern AI',
};
export const DECISION_LABELS: Record<string, string> = {
  ALLOW: 'Tillåt', WARN: 'Varning', HOLD_FOR_REVIEW: 'Väntar på granskning',
  BLOCK: 'Blockerat', ESCALATE: 'Eskalerat',
};
