import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { isConfigured, supabase } from '../lib/supabase';
import * as api from '../lib/api';
import type { Profile, Notification } from '../lib/types';

type Toast = { message: string; tone: 'success' | 'error' | 'info' } | null;
interface AppState {
  session: any; profile: Profile | null; config: Record<string, any>; moderator: string | null;
  notifications: Notification[]; unread: number; loading: boolean; error: string | null; toast: Toast;
  demoMode: boolean; configured: boolean;
  refreshProfile: () => Promise<void>; refreshConfig: () => Promise<void>; refreshNotifications: () => Promise<void>;
  showToast: (message: string, tone?: 'success' | 'error' | 'info') => void; signOut: () => Promise<void>;
}
const Ctx = createContext<AppState>(null as unknown as AppState);
export const useApp = () => useContext(Ctx);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<any>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [config, setConfig] = useState<Record<string, any>>({});
  const [moderator, setModerator] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>(null);

  const showToast = useCallback((message: string, tone: 'success' | 'error' | 'info' = 'success') => {
    setToast({ message, tone });
    setTimeout(() => setToast(null), 4200);
  }, []);

  const refreshProfile = useCallback(async () => {
    try {
      const p = await api.myProfile();
      setProfile(p);
      const role = await api.moderatorRole();
      setModerator(role);
      setError(null);
    } catch (e: any) { setError(e.message); }
  }, []);
  const refreshConfig = useCallback(async () => {
    try { setConfig(await api.getConfig()); } catch { /* config is optional for rendering */ }
  }, []);
  const refreshNotifications = useCallback(async () => {
    try { const n = await api.getNotifications(); setNotifications(n); } catch { /* */ }
  }, []);

  useEffect(() => {
    if (!isConfigured) { setError('Supabase-miljövariabler saknas (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).'); setLoading(false); return; }
    let active = true;
    api.auth.session().then(({ data }: any) => {
      if (active) { setSession(data.session); setLoading(false); }
    }).catch(() => { if (active) setLoading(false); });
    const sub = api.auth.onState((s: any) => { if (active) setSession(s); });
    return () => { active = false; sub.data?.subscription?.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!session?.user) { setProfile(null); setModerator(null); setNotifications([]); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      await Promise.all([refreshProfile(), refreshConfig(), refreshNotifications()]);
      if (!cancelled) setLoading(false);
    })();
    const off = api.subscribeNotifications(session.user.id, (n) => {
      setNotifications((prev) => [n, ...prev].slice(0, 100));
    });
    api.touchPresence();
    const timer = window.setInterval(api.touchPresence, 120000);
    return () => { cancelled = true; off(); window.clearInterval(timer); };
  }, [session?.user?.id, refreshProfile, refreshConfig, refreshNotifications]);

  const signOut = useCallback(async () => {
    await api.auth.signOut();
    setSession(null); setProfile(null); setModerator(null); setNotifications([]);
    window.location.hash = '#/upptack';
  }, []);

  const unread = notifications.filter((n) => !n.read).length;
  const demoMode = config.demo_mode === true;

  return <Ctx.Provider value={{
    session, profile, config, moderator, notifications, unread, loading, error, toast, demoMode,
    configured: isConfigured, refreshProfile, refreshConfig, refreshNotifications, showToast, signOut,
  }}>{children}</Ctx.Provider>;
}
