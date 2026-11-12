import React, { useEffect, useState } from 'react';
import { X, Loader2, AlertTriangle, Inbox } from 'lucide-react';
import { initials, hueFromId } from '../lib/utils';
import { mediaUrl } from '../lib/api';

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'outline' | 'danger' | 'soft';
  size?: 'sm' | 'md' | 'lg'; icon?: React.ReactNode; loading?: boolean; full?: boolean;
};
export function Button({ variant = 'primary', size = 'md', icon, loading, full, children, className = '', ...rest }: ButtonProps) {
  return (
    <button className={`btn btn-${variant} btn-${size} ${full ? 'btn-full' : ''} ${className}`} disabled={loading || rest.disabled} {...rest}>
      {loading ? <Loader2 size={16} className="spin" /> : icon}
      {children}
    </button>
  );
}
export function IconButton({ children, label, className = '', ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button className={`icon-btn ${className}`} aria-label={label} title={label} {...rest}>{children}</button>;
}
export function Card({ children, className = '', ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={`card ${className}`} {...rest}>{children}</div>;
}
export function Input({ label, hint, error, ...rest }: React.InputHTMLAttributes<HTMLInputElement> & { label?: string; hint?: string; error?: string }) {
  return <label className="field">
    {label && <span className="field-label">{label}</span>}
    <input className={`input ${error ? 'input-error' : ''}`} {...rest} />
    {hint && !error && <span className="field-hint">{hint}</span>}
    {error && <span className="field-error">{error}</span>}
  </label>;
}
export function Textarea({ label, hint, error, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string; hint?: string; error?: string }) {
  return <label className="field">
    {label && <span className="field-label">{label}</span>}
    <textarea className={`input textarea ${error ? 'input-error' : ''}`} {...rest} />
    {hint && !error && <span className="field-hint">{hint}</span>}
    {error && <span className="field-error">{error}</span>}
  </label>;
}
export function Select({ label, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  return <label className="field">
    {label && <span className="field-label">{label}</span>}
    <select className="input" {...rest}>{children}</select>
  </label>;
}
export function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  return <label className="toggle-row">
    <span><span className="toggle-label">{label}</span>{description && <span className="toggle-desc">{description}</span>}</span>
    <button type="button" role="switch" aria-checked={checked} className={`toggle ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
      <span className="toggle-knob" />
    </button>
  </label>;
}
export function Badge({ children, tone = 'violet', className = '' }: { children: React.ReactNode; tone?: 'violet' | 'green' | 'amber' | 'red' | 'blue' | 'grey'; className?: string }) {
  return <span className={`badge badge-${tone} ${className}`}>{children}</span>;
}
export function Chip({ active, children, onClick }: { active?: boolean; children: React.ReactNode; onClick?: () => void }) {
  return <button type="button" className={`chip ${active ? 'active' : ''}`} onClick={onClick}>{children}</button>;
}
export function Avatar({ name, url, size = 44, id, online }: { name: string; url?: string | null; size?: number; id?: string; online?: boolean }) {
  const [src, setSrc] = useState<string | null>(url && !url.startsWith('storage:') ? url : null);
  useEffect(() => {
    let alive = true;
    if (url?.startsWith('storage:')) {
      mediaUrl(url.slice(8)).then((u) => { if (alive && u) setSrc(u); }).catch(() => {});
    } else setSrc(url || null);
    return () => { alive = false; };
  }, [url]);
  const hue = hueFromId(id || name);
  return <div className="avatar" style={{ width: size, height: size, fontSize: size * 0.36, background: src ? 'transparent' : `linear-gradient(135deg, hsl(${hue} 70% 45%), hsl(${(hue + 55) % 360} 80% 60%))` }}>
    {src ? <img src={src} alt={name} /> : initials(name)}
    {online && <span className="avatar-online" />}
  </div>;
}
export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  if (!open) return null;
  return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-head"><h2>{title}</h2><IconButton label="Stäng" onClick={onClose}><X size={18} /></IconButton></div>
      <div className="modal-body">{children}</div>
    </div>
  </div>;
}
export function Spinner({ label = 'Laddar…' }: { label?: string }) {
  return <div className="state"><Loader2 size={26} className="spin" /><span>{label}</span></div>;
}
export function EmptyState({ title, description, icon, action }: { title: string; description?: string; icon?: React.ReactNode; action?: React.ReactNode }) {
  return <div className="state state-card"><div className="state-icon">{icon || <Inbox size={26} />}</div><h3>{title}</h3>{description && <p>{description}</p>}{action}</div>;
}
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="state state-card state-error"><AlertTriangle size={26} /><h3>Något gick fel</h3><p>{message}</p>{onRetry && <Button variant="outline" onClick={onRetry}>Försök igen</Button>}</div>;
}
export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return <div className="page-head"><div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{right && <div className="page-head-right">{right}</div>}</div>;
}
export function Tabs({ tabs, active, onChange }: { tabs: { id: string; label: string; count?: number }[]; active: string; onChange: (id: string) => void }) {
  return <div className="tabs">{tabs.map((t) => <button key={t.id} className={`tab ${active === t.id ? 'active' : ''}`} onClick={() => onChange(t.id)}>
    {t.label}{t.count !== undefined && <span className="tab-count">{t.count}</span>}
  </button>)}</div>;
}
export function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return <div className="stat"><span className="stat-value" style={tone ? { color: tone } : undefined}>{value}</span><span className="stat-label">{label}</span></div>;
}
export function Toast({ message, tone = 'success', onClose }: { message: string; tone?: 'success' | 'error' | 'info'; onClose: () => void }) {
  return <div className={`toast toast-${tone}`} onClick={onClose}><span>{message}</span><X size={16} /></div>;
}
export function Section({ title, description, children, right }: { title: string; description?: string; children: React.ReactNode; right?: React.ReactNode }) {
  return <section className="section"><div className="section-head"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{right}</div>{children}</section>;
}
