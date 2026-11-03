import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { WebsiteApi, WebsiteError } from '../core/api';
import { resetGoogleMapsLoader } from '../core/google-maps';
import { AddressPicker, PickedLocation } from './address-picker';

const KEY = 'AIza' + 'x'.repeat(35);
const PLACE = {
  latitude: 12.925,
  longitude: 77.5938,
  street: '4th Cross Road',
  area: 'Jayanagar',
  pincode: '560011',
  landmark: 'Near the park',
  formatted_address: '4th Cross Road, Jayanagar, Bengaluru 560011',
  serviceable: true,
  collection_fee_paise: 0,
};
const SUGGESTION = { place_id: 'p1', title: 'Jayanagar 4th Block', subtitle: 'Bengaluru' };

/** A stand-in for Google's map: tests move it and fire its "idle" event like Google does. */
class FakeMap {
  static last: FakeMap;
  center = { lat: 20.5937, lng: 78.9629 };
  zoom = 5;
  idle: (() => void) | null = null;
  setCenter = vi.fn((c: { lat: number; lng: number }) => (this.center = c));
  setZoom = vi.fn((z: number) => (this.zoom = z));
  constructor(
    public element: HTMLElement,
    public options: Record<string, unknown>,
  ) {
    FakeMap.last = this;
  }
  getCenter() {
    return { lat: () => this.center.lat, lng: () => this.center.lng };
  }
  getZoom() {
    return this.zoom;
  }
  addListener(_event: string, handler: () => void) {
    this.idle = handler;
    return { remove: vi.fn() };
  }
  /** The customer drags the map to a new spot and lets go. */
  dragTo(lat: number, lng: number, zoom = 17) {
    this.center = { lat, lng };
    this.zoom = zoom;
    this.idle?.();
  }
}

/** Gives the test browser a location sensor without replacing the rest of `navigator`. */
function setGeolocation(getCurrentPosition: unknown) {
  Object.defineProperty(navigator, 'geolocation', {
    value: { getCurrentPosition },
    configurable: true,
  });
}

describe('Address picker', () => {
  let request: ReturnType<typeof vi.fn>;
  let located: PickedLocation[];
  let mapsApiKey: string;

  async function render() {
    request = request ?? vi.fn();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: WebsiteApi,
          useValue: {
            config: signal({
              mode: 'live',
              apiBaseUrl: '',
              supabaseUrl: '',
              publishableKey: '',
              mapsApiKey,
            }),
            request,
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(AddressPicker);
    located = [];
    fixture.componentInstance.located.subscribe((p) => located.push(p));
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();
    return fixture;
  }
  const root = (f: { nativeElement: unknown }) => f.nativeElement as HTMLElement;
  const buttonWith = (el: HTMLElement, text: string) =>
    Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes(text));
  async function type(fixture: Awaited<ReturnType<typeof render>>, text: string) {
    const input = root(fixture).querySelector('input[type="search"]') as HTMLInputElement;
    input.value = text;
    input.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(400);
    fixture.detectChanges();
  }

  beforeEach(() => {
    vi.useFakeTimers();
    request = vi.fn();
    mapsApiKey = '';
    FakeMap.last = undefined as unknown as FakeMap;
  });
  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(navigator, 'geolocation');
    delete window.google;
    resetGoogleMapsLoader();
    TestBed.resetTestingModule();
  });

  describe('without a Maps key', () => {
    it('offers search and location only, with no map button', async () => {
      const fixture = await render();
      expect(root(fixture).querySelector('input[type="search"]')).not.toBeNull();
      expect(buttonWith(root(fixture), 'Use my location')).toBeDefined();
      expect(buttonWith(root(fixture), 'Pick on the map')).toBeUndefined();
    });

    it('searches after a pause, shows suggestions, and fills the form from the chosen place', async () => {
      request.mockImplementation(async (path: string) =>
        path.includes('places/search') ? [SUGGESTION] : PLACE,
      );
      const fixture = await render();
      await type(fixture, 'Jayanagar');
      expect(request).toHaveBeenCalledTimes(1);
      expect(request).toHaveBeenCalledWith('/serviceability/places/search?query=Jayanagar');
      expect(root(fixture).querySelector('.suggestions')?.textContent).toContain(
        'Jayanagar 4th Block',
      );
      buttonWith(root(fixture), 'Jayanagar 4th Block')!.click();
      await vi.advanceTimersByTimeAsync(0);
      fixture.detectChanges();
      expect(request).toHaveBeenLastCalledWith(
        '/serviceability/places/resolve?place_id=p1',
        'GET',
        undefined,
        undefined,
        false,
      );
      expect(located).toEqual([PLACE]);
      expect(root(fixture).querySelector('.picked')?.textContent).toContain('Jayanagar');
      expect(root(fixture).querySelector('.picked')?.textContent).toContain(
        'We collect samples at this pincode.',
      );
    });

    it('does not search for fewer than two characters and clears old suggestions', async () => {
      request.mockResolvedValue([SUGGESTION]);
      const fixture = await render();
      await type(fixture, 'Ja');
      expect(root(fixture).querySelector('.suggestions')).not.toBeNull();
      await type(fixture, 'J');
      expect(root(fixture).querySelector('.suggestions')).toBeNull();
      expect(request).toHaveBeenCalledTimes(1);
    });

    it('ignores a slow search answer that arrives after a newer search', async () => {
      let releaseOld!: (v: unknown) => void;
      request
        .mockImplementationOnce(() => new Promise((resolve) => (releaseOld = resolve)))
        .mockResolvedValueOnce([{ place_id: 'new', title: 'New result', subtitle: '' }]);
      const fixture = await render();
      await type(fixture, 'Old query');
      await type(fixture, 'New query');
      releaseOld([{ place_id: 'old', title: 'Old result', subtitle: '' }]);
      await vi.advanceTimersByTimeAsync(0);
      fixture.detectChanges();
      const list = root(fixture).querySelector('.suggestions')?.textContent ?? '';
      expect(list).toContain('New result');
      expect(list).not.toContain('Old result');
    });

    it('says so when a search finds nothing', async () => {
      request.mockResolvedValue([]);
      const fixture = await render();
      await type(fixture, 'Nowhere');
      expect(root(fixture).textContent).toContain('No places found');
    });

    it.each([
      ['http_429', 'Too many lookups'],
      ['http_503', 'unavailable right now'],
      ['network', 'Connection interrupted'],
      ['sign_in', 'sign in again'],
      ['http_500', 'could not find that place'],
    ])('explains a %s failure in plain words and fills nothing', async (code, words) => {
      request.mockRejectedValue(new WebsiteError(code));
      const fixture = await render();
      await type(fixture, 'Jayanagar');
      expect(root(fixture).querySelector('[role="alert"]')?.textContent).toContain(words);
      expect(located).toEqual([]);
    });

    it('refuses a place answer that has no valid pincode', async () => {
      request.mockResolvedValue({ ...PLACE, pincode: '12' });
      const fixture = await render();
      fixture.componentInstance['choose'](SUGGESTION);
      await vi.advanceTimersByTimeAsync(0);
      fixture.detectChanges();
      expect(located).toEqual([]);
      expect(root(fixture).querySelector('[role="alert"]')).not.toBeNull();
    });

    it('does not submit the surrounding form when Enter is pressed in the search box', async () => {
      const fixture = await render();
      const input = root(fixture).querySelector('input[type="search"]') as HTMLInputElement;
      const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
      input.dispatchEvent(enter);
      expect(enter.defaultPrevented).toBe(true);
    });

    it('looks up the position the browser shares', async () => {
      request.mockResolvedValue(PLACE);
      setGeolocation((ok: (p: unknown) => void) =>
        ok({ coords: { latitude: 12.925, longitude: 77.5938 } }),
      );
      const fixture = await render();
      buttonWith(root(fixture), 'Use my location')!.click();
      await vi.advanceTimersByTimeAsync(0);
      fixture.detectChanges();
      expect(request).toHaveBeenCalledWith(
        '/serviceability/places/resolve?lat=12.925000&lng=77.593800',
        'GET',
        undefined,
        undefined,
        false,
      );
      expect(located).toEqual([PLACE]);
    });

    it('stays calm when location is refused, and looks nothing up', async () => {
      setGeolocation((_ok: unknown, fail: (e: unknown) => void) => fail({ code: 1 }));
      const fixture = await render();
      buttonWith(root(fixture), 'Use my location')!.click();
      await vi.advanceTimersByTimeAsync(0);
      fixture.detectChanges();
      expect(root(fixture).querySelector('[role="alert"]')?.textContent).toContain(
        'could not get your location',
      );
      expect(request).not.toHaveBeenCalled();
    });

    it('warns when the pincode is outside the collection area', async () => {
      request.mockResolvedValue({ ...PLACE, serviceable: false, collection_fee_paise: null });
      const fixture = await render();
      fixture.componentInstance['choose'](SUGGESTION);
      await vi.advanceTimersByTimeAsync(0);
      fixture.detectChanges();
      expect(root(fixture).querySelector('.picked')?.textContent).toContain(
        'do not collect samples at this pincode yet',
      );
    });
  });

  describe('with a Maps key', () => {
    beforeEach(() => {
      mapsApiKey = KEY;
      window.google = { maps: { importLibrary: vi.fn().mockResolvedValue({ Map: FakeMap }) } };
    });
    async function openMap(fixture: Awaited<ReturnType<typeof render>>) {
      buttonWith(root(fixture), 'Pick on the map')!.click();
      await vi.advanceTimersByTimeAsync(10);
      fixture.detectChanges();
      await vi.advanceTimersByTimeAsync(10);
      fixture.detectChanges();
    }

    it('loads Google only when the customer asks for the map', async () => {
      const fixture = await render();
      expect(window.google!.maps!.importLibrary).not.toHaveBeenCalled();
      expect(root(fixture).querySelector('.map')).toBeNull();
      await openMap(fixture);
      expect(window.google!.maps!.importLibrary).toHaveBeenCalledWith('maps');
      expect(FakeMap.last).toBeDefined();
      expect(FakeMap.last.options['zoom']).toBe(5);
    });

    it('looks up the pin only after the customer moves a zoomed-in map and stops', async () => {
      request.mockResolvedValue(PLACE);
      const fixture = await render();
      await openMap(fixture);
      // Google reports "idle" once the map first appears: that is not the customer moving it.
      FakeMap.last.idle?.();
      await vi.advanceTimersByTimeAsync(1000);
      expect(request).not.toHaveBeenCalled();
      FakeMap.last.dragTo(12.925, 77.5938, 17);
      await vi.advanceTimersByTimeAsync(300);
      expect(request).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(400);
      fixture.detectChanges();
      expect(request).toHaveBeenCalledWith(
        '/serviceability/places/resolve?lat=12.925000&lng=77.593800',
        'GET',
        undefined,
        undefined,
        false,
      );
      expect(located).toEqual([PLACE]);
    });

    it('waits for the customer to stop: several quick moves make one lookup', async () => {
      request.mockResolvedValue(PLACE);
      const fixture = await render();
      await openMap(fixture);
      FakeMap.last.idle?.();
      FakeMap.last.dragTo(12.9, 77.5);
      await vi.advanceTimersByTimeAsync(300);
      FakeMap.last.dragTo(12.91, 77.51);
      await vi.advanceTimersByTimeAsync(300);
      FakeMap.last.dragTo(12.92, 77.52);
      await vi.advanceTimersByTimeAsync(1000);
      expect(request).toHaveBeenCalledTimes(1);
      expect(request.mock.calls[0][0]).toContain('lat=12.920000&lng=77.520000');
    });

    it('does not look anything up while the map is zoomed out to a whole country', async () => {
      const fixture = await render();
      await openMap(fixture);
      FakeMap.last.idle?.();
      FakeMap.last.dragTo(21, 79, 6);
      await vi.advanceTimersByTimeAsync(2000);
      expect(request).not.toHaveBeenCalled();
    });

    it('moves the map to a searched place without looking that move up again', async () => {
      request.mockImplementation(async (path: string) =>
        path.includes('places/search') ? [SUGGESTION] : PLACE,
      );
      const fixture = await render();
      await openMap(fixture);
      FakeMap.last.idle?.();
      await type(fixture, 'Jayanagar');
      buttonWith(root(fixture), 'Jayanagar 4th Block')!.click();
      await vi.advanceTimersByTimeAsync(0);
      expect(FakeMap.last.setCenter).toHaveBeenCalledWith({ lat: 12.925, lng: 77.5938 });
      expect(FakeMap.last.setZoom).toHaveBeenCalledWith(17);
      const lookups = request.mock.calls.length;
      FakeMap.last.idle?.(); // Google's "idle" after the code moved the map
      await vi.advanceTimersByTimeAsync(2000);
      expect(request).toHaveBeenCalledTimes(lookups);
    });

    it('falls back to search when Google cannot be loaded', async () => {
      window.google = { maps: { importLibrary: vi.fn().mockRejectedValue(new Error('down')) } };
      const fixture = await render();
      await openMap(fixture);
      expect(root(fixture).querySelector('.map')).toBeNull();
      expect(root(fixture).querySelector('[role="alert"]')?.textContent).toContain(
        'map is not available',
      );
      expect(root(fixture).querySelector('input[type="search"]')).not.toBeNull();
    });

    it('falls back to search when Google refuses the key', async () => {
      const fixture = await render();
      await openMap(fixture);
      window.gm_authFailure?.();
      fixture.detectChanges();
      expect(root(fixture).querySelector('.map')).toBeNull();
      expect(root(fixture).querySelector('[role="alert"]')?.textContent).toContain(
        'map is not available',
      );
    });
  });

  describe('with a key that is not a Maps key', () => {
    it('keeps the map off, as with no key', async () => {
      mapsApiKey = 'sb_publishable_not_a_maps_key';
      const fixture = await render();
      expect(buttonWith(root(fixture), 'Pick on the map')).toBeUndefined();
    });
  });
});
