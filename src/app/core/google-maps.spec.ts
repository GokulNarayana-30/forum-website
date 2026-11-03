import {
  loadGoogleMaps,
  mapsKeyUsable,
  onMapsAuthFailure,
  resetGoogleMapsLoader,
} from './google-maps';

const KEY = 'AIza' + 'x'.repeat(35);

describe('Google Maps loading', () => {
  afterEach(() => {
    resetGoogleMapsLoader();
    delete window.google;
    vi.restoreAllMocks();
  });

  it('accepts only a key shaped like a Google Maps browser key', () => {
    expect(mapsKeyUsable(KEY)).toBe(true);
    expect(mapsKeyUsable('')).toBe(false);
    expect(mapsKeyUsable(undefined)).toBe(false);
    expect(mapsKeyUsable('not-a-key')).toBe(false);
    expect(mapsKeyUsable('AIza short')).toBe(false);
  });

  it('refuses to load without a usable key and adds no script to the page', async () => {
    const append = vi.spyOn(document.head, 'appendChild');
    await expect(loadGoogleMaps('')).rejects.toMatchObject({ code: 'maps_key' });
    await expect(loadGoogleMaps('nonsense')).rejects.toMatchObject({ code: 'maps_key' });
    expect(append).not.toHaveBeenCalled();
  });

  it('uses Google Maps already on the page, once, without a second script', async () => {
    const lib = { Map: class {} };
    const importLibrary = vi.fn().mockResolvedValue(lib);
    window.google = { maps: { importLibrary } };
    const append = vi.spyOn(document.head, 'appendChild');
    const [first, second] = await Promise.all([loadGoogleMaps(KEY), loadGoogleMaps(KEY)]);
    expect(first).toBe(lib);
    expect(second).toBe(lib);
    expect(importLibrary).toHaveBeenCalledTimes(1);
    expect(importLibrary).toHaveBeenCalledWith('maps');
    expect(append).not.toHaveBeenCalled();
  });

  it('adds one Google script with the key encoded, then resolves when it loads', async () => {
    const append = vi.spyOn(document.head, 'appendChild').mockImplementation((node) => node);
    const pending = loadGoogleMaps(KEY);
    const script = append.mock.calls[0][0] as HTMLScriptElement;
    expect(script.src).toContain('https://maps.googleapis.com/maps/api/js?key=' + KEY);
    expect(script.src).toContain('loading=async');
    const lib = { Map: class {} };
    window.google = { maps: { importLibrary: vi.fn().mockResolvedValue(lib) } };
    script.onload?.(new Event('load'));
    await expect(pending).resolves.toBe(lib);
    await loadGoogleMaps(KEY);
    expect(append).toHaveBeenCalledTimes(1);
  });

  it('fails when the script cannot load, and a later try starts again', async () => {
    const append = vi.spyOn(document.head, 'appendChild').mockImplementation((node) => node);
    const first = loadGoogleMaps(KEY);
    (append.mock.calls[0][0] as HTMLScriptElement).onerror?.(new Event('error'));
    await expect(first).rejects.toMatchObject({ code: 'maps_load' });
    const second = loadGoogleMaps(KEY);
    expect(append).toHaveBeenCalledTimes(2);
    (append.mock.calls[1][0] as HTMLScriptElement).onerror?.(new Event('error'));
    await expect(second).rejects.toMatchObject({ code: 'maps_load' });
  });

  it('tells listeners when Google refuses the key, until they stop listening', () => {
    const heard = vi.fn();
    const stop = onMapsAuthFailure(heard);
    window.gm_authFailure?.();
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
    window.gm_authFailure?.();
    expect(heard).toHaveBeenCalledTimes(1);
  });
});
