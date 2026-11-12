import { createClient } from '@supabase/supabase-js';

const url = (import.meta.env.VITE_SUPABASE_URL as string) || '';
const anon = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';

export const isConfigured = Boolean(url && anon);

export const supabase = createClient(url || 'https://unconfigured.supabase.co', anon || 'unconfigured', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  realtime: { params: { eventsPerSecond: 8 } },
});
