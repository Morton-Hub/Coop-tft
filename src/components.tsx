import { memo, useState } from 'react';
import type { Champion } from './data/types';

/** Portrait d'un champion ; ses initiales si l'image ne charge pas. */
export const Icon = memo(function Icon({ c }: { c: Champion }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className={`icon cost-${c.cost}`}>
      {c.icon && !broken ? (
        <img src={c.icon} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} />
      ) : (
        <span className="initials">{c.name.slice(0, 3)}</span>
      )}
    </span>
  );
});

export function Bar({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="bar">
      <span>{label}</span>
      <div className="track">
        <div className={`fill ${tone ?? ''}`} style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
      <b>{Math.round(value * 100)} %</b>
    </div>
  );
}
