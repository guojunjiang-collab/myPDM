import { useEffect, useState } from 'react';

export const MOBILE_QUERY = '(max-width: 767px)';

export function subscribeMediaQuery(query: string, onChange: (matches: boolean) => void): () => void {
  if (typeof globalThis === 'undefined' || typeof globalThis.matchMedia !== 'function') {
    return () => {};
  }
  const mql = globalThis.matchMedia(query);
  onChange(mql.matches);
  const handler = (e: MediaQueryListEvent) => onChange(e.matches);
  mql.addEventListener('change', handler);
  return () => mql.removeEventListener('change', handler);
}

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(
    () => typeof globalThis !== 'undefined' && typeof globalThis.matchMedia === 'function'
      ? globalThis.matchMedia(MOBILE_QUERY).matches
      : false,
  );
  useEffect(() => subscribeMediaQuery(MOBILE_QUERY, setIsMobile), []);
  return isMobile;
}
