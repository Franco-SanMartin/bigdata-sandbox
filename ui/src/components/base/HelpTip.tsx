/* El "?" chico al lado de un rótulo: ayuda contextual sin ocupar lugar. */
import type { ReactNode } from 'react';
import { Tip } from '../ui';

export function HelpTip({ children, label = 'Ayuda' }: { children: ReactNode; label?: string }) {
  return (
    <Tip content={children}>
      <button type="button" className="helptip" aria-label={label}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M3.3 3.6a1.8 1.8 0 1 1 2.6 1.6c-.6.3-.9.6-.9 1.2v.3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /><circle cx="5" cy="8.4" r=".75" fill="currentColor" /></svg>
      </button>
    </Tip>
  );
}
