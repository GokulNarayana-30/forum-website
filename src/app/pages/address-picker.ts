import {
  Component,
  ElementRef,
  OnDestroy,
  computed,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { WebsiteApi, WebsiteError } from '../core/api';
import { MapInstance, loadGoogleMaps, mapsKeyUsable, onMapsAuthFailure } from '../core/google-maps';
import { money } from '../core/models';

/** What the API's place lookup answers for a place, a map pin or a GPS position. */
export interface PickedLocation {
  latitude: number;
  longitude: number;
  street: string;
  area: string;
  pincode: string;
  landmark: string | null;
  formatted_address: string;
  serviceable: boolean;
  collection_fee_paise: number | null;
}
interface Suggestion {
  place_id: string;
  title: string;
  subtitle: string;
}

// A map this far out shows a country, not a door: a drag there looks nothing up.
const MIN_ZOOM_TO_LOOK_UP = 15;
const INDIA = { lat: 20.5937, lng: 78.9629 };
const SEARCH_DELAY_MS = 350;
const PIN_SETTLE_MS = 600;

@Component({
  selector: 'forum-address-picker',
  imports: [FormsModule],
  templateUrl: './address-picker.html',
  styleUrl: './address-picker.scss',
})
export class AddressPicker implements OnDestroy {
  private readonly api = inject(WebsiteApi);
  private readonly mapElement = viewChild<ElementRef<HTMLElement>>('mapElement');
  /** The place the customer chose, ready to fill the address form. */
  readonly located = output<PickedLocation>();

  protected queryText = '';
  protected readonly suggestions = signal<Suggestion[]>([]);
  protected readonly searched = signal(false);
  protected readonly locating = signal(false);
  protected readonly resolving = signal(false);
  protected readonly notice = signal('');
  protected readonly picked = signal<PickedLocation | null>(null);
  protected readonly showMap = signal(false);
  protected readonly mapState = signal<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  protected readonly mapAvailable = computed(() => mapsKeyUsable(this.api.config().mapsApiKey));

  private map: MapInstance | null = null;
  private idleListener: { remove(): void } | null = null;
  private stopAuthWatch: (() => void) | null = null;
  private searchTimer: ReturnType<typeof setTimeout> | undefined;
  private pinTimer: ReturnType<typeof setTimeout> | undefined;
  private searchSequence = 0;
  private lookupSequence = 0;
  // The map reports "idle" after the code moves it too; only a customer's own move is looked up.
  private movedByCode = false;
  private destroyed = false;

  protected price(paise: number): string {
    return money(paise);
  }

  protected onQuery(value: string): void {
    this.queryText = value;
    clearTimeout(this.searchTimer);
    this.searched.set(false);
    if (value.trim().length < 2) {
      this.searchSequence += 1;
      this.suggestions.set([]);
      return;
    }
    this.searchTimer = setTimeout(() => void this.search(value.trim()), SEARCH_DELAY_MS);
  }

  private async search(query: string): Promise<void> {
    const sequence = ++this.searchSequence;
    this.notice.set('');
    try {
      const found = await this.api.request<unknown>(
        '/serviceability/places/search?query=' + encodeURIComponent(query),
      );
      if (sequence !== this.searchSequence || this.destroyed) return;
      const list = Array.isArray(found) ? found : [];
      this.suggestions.set(
        list.flatMap((item: Partial<Suggestion>) =>
          typeof item?.place_id === 'string' && typeof item.title === 'string'
            ? [
                {
                  place_id: item.place_id,
                  title: item.title,
                  subtitle: typeof item.subtitle === 'string' ? item.subtitle : '',
                },
              ]
            : [],
        ),
      );
      this.searched.set(true);
    } catch (error) {
      if (sequence !== this.searchSequence || this.destroyed) return;
      this.suggestions.set([]);
      this.notice.set(this.describe(error));
    }
  }

  protected choose(suggestion: Suggestion): void {
    this.suggestions.set([]);
    this.queryText = suggestion.title;
    void this.lookUp('?place_id=' + encodeURIComponent(suggestion.place_id), true);
  }

  protected async useMyLocation(): Promise<void> {
    this.notice.set('');
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      this.notice.set('This browser cannot share your location. Search for your address instead.');
      return;
    }
    this.locating.set(true);
    try {
      const here = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
        }),
      );
      if (this.destroyed) return;
      await this.lookUp(this.coordinateQuery(here.coords.latitude, here.coords.longitude), true);
    } catch {
      if (!this.destroyed)
        this.notice.set(
          'We could not get your location. Allow location access, or search for your address instead.',
        );
    } finally {
      this.locating.set(false);
    }
  }

  protected async openMap(): Promise<void> {
    this.showMap.set(true);
    this.mapState.set('loading');
    this.notice.set('');
    try {
      const maps = await loadGoogleMaps(this.api.config().mapsApiKey);
      // Wait one tick so the map's element has been drawn.
      await new Promise((resolve) => setTimeout(resolve));
      const element = this.mapElement()?.nativeElement;
      if (!element || this.destroyed) return;
      const start = this.picked();
      this.movedByCode = true;
      this.map = new maps.Map(element, {
        center: start ? { lat: start.latitude, lng: start.longitude } : INDIA,
        zoom: start ? 17 : 5,
        disableDefaultUI: true,
        zoomControl: true,
        gestureHandling: 'greedy',
        clickableIcons: false,
      });
      this.idleListener = this.map.addListener('idle', () => this.onMapIdle());
      this.stopAuthWatch ??= onMapsAuthFailure(() => this.mapFailed());
      this.mapState.set('ready');
    } catch {
      this.mapFailed();
    }
  }

  private mapFailed(): void {
    if (this.destroyed) return;
    this.mapState.set('failed');
    this.showMap.set(false);
    this.notice.set(
      'The map is not available right now. You can still search or use your location.',
    );
  }

  private onMapIdle(): void {
    if (this.movedByCode) {
      this.movedByCode = false;
      return;
    }
    const center = this.map?.getCenter();
    if (!center || (this.map?.getZoom() ?? 0) < MIN_ZOOM_TO_LOOK_UP) return;
    clearTimeout(this.pinTimer);
    // Wait for the customer to stop moving the map before looking the pin up.
    this.pinTimer = setTimeout(
      () => void this.lookUp(this.coordinateQuery(center.lat(), center.lng()), false),
      PIN_SETTLE_MS,
    );
  }

  private coordinateQuery(latitude: number, longitude: number): string {
    return `?lat=${latitude.toFixed(6)}&lng=${longitude.toFixed(6)}`;
  }

  /** Asks the API what is at a place, pin or position, then hands it to the address form. */
  private async lookUp(query: string, moveMap: boolean): Promise<void> {
    const sequence = ++this.lookupSequence;
    this.resolving.set(true);
    this.notice.set('');
    try {
      const body = await this.api.request<Partial<PickedLocation>>(
        '/serviceability/places/resolve' + query,
        'GET',
        undefined,
        undefined,
        false,
      );
      if (sequence !== this.lookupSequence || this.destroyed) return;
      const place = this.readLocation(body);
      if (!place) throw new WebsiteError('response');
      this.picked.set(place);
      this.located.emit(place);
      if (moveMap && this.map) {
        this.movedByCode = true;
        this.map.setCenter({ lat: place.latitude, lng: place.longitude });
        this.map.setZoom(17);
      }
    } catch (error) {
      if (sequence === this.lookupSequence && !this.destroyed)
        this.notice.set(this.describe(error));
    } finally {
      if (sequence === this.lookupSequence) this.resolving.set(false);
    }
  }

  private readLocation(body: Partial<PickedLocation> | null): PickedLocation | null {
    if (
      !body ||
      !Number.isFinite(body.latitude) ||
      !Number.isFinite(body.longitude) ||
      typeof body.street !== 'string' ||
      typeof body.area !== 'string' ||
      typeof body.pincode !== 'string' ||
      !/^[1-9][0-9]{5}$/.test(body.pincode)
    )
      return null;
    return {
      latitude: body.latitude as number,
      longitude: body.longitude as number,
      street: body.street,
      area: body.area,
      pincode: body.pincode,
      landmark: typeof body.landmark === 'string' ? body.landmark : null,
      formatted_address: typeof body.formatted_address === 'string' ? body.formatted_address : '',
      serviceable: body.serviceable === true,
      collection_fee_paise: Number.isInteger(body.collection_fee_paise)
        ? (body.collection_fee_paise as number)
        : null,
    };
  }

  private describe(error: unknown): string {
    const code = error instanceof WebsiteError ? error.code : '';
    if (code === 'http_429') return 'Too many lookups. Please wait a moment and try again.';
    if (code === 'sign_in') return 'Please sign in again to search for an address.';
    if (code === 'network')
      return 'Connection interrupted. Check your internet and try again, or type the address below.';
    if (code === 'http_503')
      return 'Address lookup is unavailable right now. Please type your address below.';
    return 'We could not find that place. Try another search, or type your address below.';
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    clearTimeout(this.searchTimer);
    clearTimeout(this.pinTimer);
    this.idleListener?.remove();
    this.stopAuthWatch?.();
  }
}
