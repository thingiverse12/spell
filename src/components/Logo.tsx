export function Logo({ size = 38, withWord = true, compact = false }: { size?: number; withWord?: boolean; compact?: boolean }) {
  const gid = `nexa-grad-${size}-${compact ? 'c' : 'f'}`;
  return <div className="logo" style={{ gap: compact ? 8 : 11 }}>
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="NEXA logotyp">
      <defs><linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#873BFA" /><stop offset="100%" stopColor="#B45CFF" />
      </linearGradient></defs>
      <path d="M8 32c0-8 6-14 13-14 6 0 9 4 11 9 2-5 5-9 11-9 7 0 13 6 13 14s-6 14-13 14c-6 0-9-4-11-9-2 5-5 9-11 9C14 46 8 40 8 32z"
        fill="none" stroke={`url(#${gid})`} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M32 29c1.8-4.5 7-4 9-0.6 2 3.4-1.3 7.4-9 13.6-7.7-6.2-11-10.2-9-13.6 2-3.4 7.2-3.9 9 .6z"
        fill={`url(#${gid})`} opacity="0.95" />
    </svg>
    {withWord && <div className="logo-word"><span className="logo-name">NEXA</span>{!compact && <span className="logo-tag">Connect. Talk. Belong.</span>}</div>}
  </div>;
}
