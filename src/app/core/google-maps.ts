import { WebsiteError } from './api';

// The few Google Maps pieces the address picker uses. They are typed here, not with Google's
// type package, so the site needs no extra dependency.
export interface LatLngLiteral {
  lat: number;
  lng: number;
}
export interface MapInstance {
  getCenter(): { lat(): number; lng(): number } | undefined;
  getZoom(): number | undefined;
  setCenter(center: LatLngLiteral): void;
  setZoom(zoom: number): void;
  addListener(event: string, handler: () => void): { remove(): void };
}
export interface MapsLibrary {
  Map: new (element: HTMLElement, options: Record<string, unknown>) => MapInstance;
}
declare global {
  interface Window {
    google?: { maps?: { importLibrary?: (name: string) => Promise<unknown> } };
    gm_authFailure?: () => void;
  }
}

/** A Google Maps browser key has this shape. Anything else is treated as "no key": the map stays off. */
export function mapsKeyUsable(key: string | undefined): key is string {
  return typeof key === 'string' && /^AIza[0-9A-Za-z_-]{30,}$/.test(key);
}

const LOAD_TIMEOUT_MS = 15000;
let loading: Promise<MapsLibrary> | null = null;
const authFailureHandlers = new Set<() => void>();

// Google calls this when it refuses the key (wrong site address, API not enabled, billing off).
// That happens after the map is drawn, so it is reported separately from loading.
if (typeof window !== 'undefined') {
  window.gm_authFailure = () => authFailureHandlers.forEach((handler) => handler());
}

/** Calls [handler] if Google refuses the key. Returns a function that stops listening. */
export function onMapsAuthFailure(handler: () => void): () => void {
  authFailureHandlers.add(handler);
  return () => authFailureHandlers.delete(handler);
}

/** Loads Google Maps once, only when a visitor opens the map. */
export function loadGoogleMaps(key: string | undefined): Promise<MapsLibrary> {
  if (!mapsKeyUsable(key)) return Promise.reject(new WebsiteError('maps_key'));
  loading ??= new Promise<MapsLibrary>((resolve, reject) => {
    const ready = () => {
      const importLibrary = window.google?.maps?.importLibrary;
      if (!importLibrary) return reject(new WebsiteError('maps_load'));
      importLibrary('maps').then(
        (lib) => resolve(lib as MapsLibrary),
        () => reject(new WebsiteError('maps_load')),
      );
    };
    if (window.google?.maps?.importLibrary) return ready();
    const script = document.createElement('script');
    script.async = true;
    script.src =
      'https://maps.googleapis.com/maps/api/js?key=' +
      encodeURIComponent(key) +
      '&v=weekly&loading=async&language=en&region=IN';
    const timer = setTimeout(() => reject(new WebsiteError('maps_load')), LOAD_TIMEOUT_MS);
    script.onload = () => {
      clearTimeout(timer);
      ready();
    };
    script.onerror = () => {
      clearTimeout(timer);
      reject(new WebsiteError('maps_load'));
    };
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    loading = null; // a later try may succeed (offline, then online)
    throw error;
  });
  return loading;
}

/** For tests: forget a loaded or failed Google Maps. */
export function resetGoogleMapsLoader(): void {
  loading = null;
  authFailureHandlers.clear();
}
