import React, { useEffect, useState } from 'react';
import {
  SESSION_HEALTH_LOCAL_ONLY,
  SESSION_HEALTH_OK,
  SESSION_HEALTH_REJECTED,
  getSessionHealth,
  subscribeSessionHealth,
} from '@shared/lib/sessionHealthBus.js';

/**
 * Makes a broken sync session visible.
 *
 * Without this the app looks perfectly healthy while every server call is
 * rejected: the avatar renders from the locally cached user object and the
 * only hint is a console error. Users have no way to know that logging in
 * again is what fixes it — so the banner says exactly that.
 */
export const SessionHealthBanner = () => {
  const [health, setHealth] = useState(getSessionHealth);

  useEffect(() => subscribeSessionHealth(setHealth), []);

  if (!health || health.status === SESSION_HEALTH_OK) {
    return null;
  }

  const isRejected = health.status === SESSION_HEALTH_REJECTED;
  const title = isRejected
    ? 'Sitzung abgelaufen — Sync pausiert'
    : 'Nur lokal angemeldet — Sync inaktiv';
  const message = isRejected
    ? 'Der Server hat die gespeicherte Anmeldung abgelehnt. Sie wurde entfernt. Melde dich neu an, damit deine Daten wieder synchronisiert werden.'
    : 'Die Anmeldung am Server ist fehlgeschlagen, die App läuft im lokalen Modus weiter. Deine Änderungen bleiben auf diesem Gerät, bis du dich erneut anmeldest.';

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-amber-200"
    >
      <span className="text-xs font-semibold uppercase tracking-wider">{title}</span>
      <span className="text-xs text-amber-100/80">{message}</span>
      {health.reason && (
        <span className="text-[10px] text-amber-100/50" title={health.reason}>
          ({String(health.reason).slice(0, 80)})
        </span>
      )}
    </div>
  );
};

export default SessionHealthBanner;
