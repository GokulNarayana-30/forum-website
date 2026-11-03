import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { WebsiteStore } from './store';
import { WebsiteApi, WebsiteError } from './api';
import { WebsiteClock } from './clock';
import { Config, Order } from './models';

describe('Customer website booking boundaries', () => {
  const now = Date.parse('2026-11-02T06:00:00Z');
  let store: WebsiteStore;
  let api: {
    config: ReturnType<typeof signal<Config>>;
    signedIn: ReturnType<typeof signal<boolean>>;
    request: ReturnType<typeof vi.fn>;
    configure: ReturnType<typeof vi.fn>;
    clearSession: ReturnType<typeof vi.fn>;
  };
  beforeEach(() => {
    sessionStorage.clear();
    api = {
      config: signal<Config>({
        mode: 'preview',
        apiBaseUrl: '',
        supabaseUrl: '',
        publishableKey: '',
      }),
      signedIn: signal(false),
      request: vi.fn(),
      configure: vi.fn().mockResolvedValue(undefined),
      clearSession: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        WebsiteStore,
        { provide: WebsiteApi, useValue: api },
        {
          provide: WebsiteClock,
          useValue: { now: () => now, iso: () => new Date(now).toISOString() },
        },
      ],
    });
    store = TestBed.inject(WebsiteStore);
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    sessionStorage.clear();
  });
  function liveCheckout() {
    api.config.set({
      mode: 'live',
      apiBaseUrl: 'https://api.example.invalid/v1',
      supabaseUrl: 'https://auth.example.invalid',
      publishableKey: 'sb_publishable_example',
    });
    api.signedIn.set(true);
    store.profile.set({ id: 'owner-a', name: 'Test', relation: 'self' });
    store.lines.set([
      {
        id: 'line-1',
        item_id: 'test-1',
        item_name: 'Test',
        kind: 'test',
        person_id: 'me',
        price_paise: 10000,
        mrp_paise: 10000,
      },
    ]);
    store.address.set({
      id: 'address-a',
      type: 'home',
      house: 'Test',
      area: 'Test',
      pincode: '560068',
    });
    store.slot.set({
      id: 'slot-a',
      starts_at: '2026-11-05T07:00:00+05:30',
      ends_at: '2026-11-05T08:00:00+05:30',
      capacity_left: 1,
      best_for_fasting: true,
    });
    store.quote.set({
      quote_id: 'quote-a',
      cart_id: 'cart-a',
      item_total_paise: 10000,
      collection_fee_paise: 5000,
      taxes_paise: 0,
      discount_paise: 0,
      to_pay_paise: 15000,
      expires_at: '2026-11-02T07:00:00Z',
    });
    store.held.set(true);
    store.holdExpires.set(now + 3600000);
    store.preparationRead.set(true);
    store.setConsent(true);
  }
  const order: Order = {
    id: 'order-a',
    booking_ref: 'FL-EXAMPLE',
    status: 'confirmed',
    total_paise: 15000,
    patients: [],
  };
  it('preview completion makes no server request and no fake booking', async () => {
    store.terms.set(true);
    await store.signIn();
    await store.add(store.items()[0]);
    await store.chooseAddress('sample-home');
    await store.chooseSlot(store.days()[0].slots[0]);
    store.preparationRead.set(true);
    store.setConsent(true);
    expect(await store.place()).toBe(true);
    expect(store.previewComplete()).toBe(true);
    expect(store.confirmed()).toBeNull();
    expect(api.request).not.toHaveBeenCalled();
  });
  it('deduplicates guest selections instead of doubling their price', async () => {
    await store.add(store.items()[0]);
    await store.add(store.items()[0]);
    expect(store.lines()).toHaveLength(1);
    expect(store.total()).toBe(store.lines()[0].price_paise);
  });
  it('an address change clears the old slot and consent', async () => {
    store.terms.set(true);
    await store.signIn();
    await store.chooseAddress('sample-home');
    await store.chooseSlot(store.days()[0].slots[0]);
    store.preparationRead.set(true);
    store.setConsent(true);
    await store.chooseAddress('sample-home');
    expect(store.slot()).toBeNull();
    expect(store.held()).toBe(false);
    expect(store.consent()).toBe(false);
  });
  it('cannot leave address or preparation steps without their prerequisites', async () => {
    store.step.set(1);
    expect(await store.next()).toBe(false);
    expect(store.step()).toBe(1);
    store.step.set(3);
    expect(await store.next()).toBe(false);
    expect(store.step()).toBe(3);
  });
  it('places a live booking using server quote IDs and total, never client amounts', async () => {
    liveCheckout();
    api.request.mockResolvedValueOnce(null).mockResolvedValueOnce({ kind: 'order_placed', order });
    expect(await store.place()).toBe(true);
    const [path, method, body, key] = api.request.mock.calls[1];
    expect(path).toBe('/orders');
    expect(method).toBe('POST');
    expect(body.quote_id).toBe('quote-a');
    expect(body.checkout_attempt_id).toBe(key);
    expect(key).toMatch(/^chk_[a-f0-9]{32}$/);
    expect(body).not.toHaveProperty('amount');
    expect(body).not.toHaveProperty('total_paise');
    expect(store.confirmed()).toEqual(order);
    expect(store.lines()).toHaveLength(0);
  });
  it('freezes the exact payload and key when an order response is lost', async () => {
    liveCheckout();
    api.request
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new WebsiteError('network'))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ kind: 'order_placed', order });
    expect(await store.place()).toBe(false);
    const first = api.request.mock.calls[1];
    expect(store.canEdit()).toBe(false);
    const saved = sessionStorage.getItem('forum-web-attempt')!;
    expect(saved).not.toContain('accepted_at');
    expect(saved).not.toContain('diagnostic_accepted');
    await store.place();
    const second = api.request.mock.calls[3];
    expect(second[2]).toEqual(first[2]);
    expect(second[3]).toBe(first[3]);
    expect(store.confirmed()).toEqual(order);
  });
  it('recovers an already-created booking without issuing a second POST', async () => {
    liveCheckout();
    api.request
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new WebsiteError('network'))
      .mockResolvedValueOnce(order);
    await store.place();
    await store.place();
    expect(api.request.mock.calls.filter((c) => c[1] === 'POST')).toHaveLength(1);
    expect(store.confirmed()).toEqual(order);
  });
  it('refuses to post without consent or when a changed quote is unaccepted', async () => {
    liveCheckout();
    store.consent.set(false);
    expect(await store.place()).toBe(false);
    expect(api.request).not.toHaveBeenCalled();
    store.preparationRead.set(true);
    store.setConsent(true);
    store.priceChanged.set(true);
    expect(await store.place()).toBe(false);
    expect(api.request).not.toHaveBeenCalled();
  });
  it('does not post an expired quote or hold', async () => {
    liveCheckout();
    store.holdExpires.set(now - 1);
    api.request.mockResolvedValue({
      cart: { id: 'cart-a', lines: store.lines() },
      people: [],
      quote: null,
    });
    expect(await store.place()).toBe(false);
    expect(api.request.mock.calls.some((c) => c[1] === 'POST')).toBe(false);
    expect(store.step()).toBe(2);
  });
  it('never labels a slot refusal as a confirmed booking', async () => {
    liveCheckout();
    api.request.mockResolvedValueOnce(null).mockResolvedValueOnce({ kind: 'slot_unavailable' });
    expect(await store.place()).toBe(false);
    expect(store.confirmed()).toBeNull();
    expect(store.slot()).toBeNull();
    expect(store.step()).toBe(2);
    expect(store.attempt()).toBeNull();
  });
  it('blocks overlapping actions while a request is in flight', async () => {
    let finish!: () => void;
    const pending = store.run(() => new Promise<void>((r) => (finish = r)));
    expect(
      await store.run(async () => {
        throw new Error('must not run');
      }),
    ).toBe(false);
    finish();
    await pending;
    expect(store.busy()).toBe(false);
  });
  it('sign out clears private patient, cart, report and checkout state', async () => {
    liveCheckout();
    store.signOut();
    expect(store.people()).toEqual([]);
    expect(store.profile()).toBeNull();
    expect(store.lines()).toEqual([]);
    expect(store.address()).toBeNull();
    expect(store.slot()).toBeNull();
    expect(store.consent()).toBe(false);
  });
  it('a recovered attempt without its original consent cannot create a new POST', async () => {
    liveCheckout();
    store.attempt.set({ key: 'chk_existing', owner: 'owner-a', body: null });
    api.request.mockResolvedValue(null);
    expect(await store.place()).toBe(false);
    expect(api.request).toHaveBeenCalledTimes(1);
    expect(api.request.mock.calls[0][0]).toContain('/checkout/attempts/');
    expect(store.attempt()).not.toBeNull();
  });
  it('expired report links are blocked before navigation', () => {
    store.documentLink.set({ url: 'https://files.example.invalid/report', expiresAt: now - 1 });
    const event = new Event('click', { cancelable: true });
    store.checkDocument(event);
    expect(event.defaultPrevented).toBe(true);
    expect(store.documentLink()).toBeNull();
  });
  it('session expiry clears private data while the application remains open', () => {
    liveCheckout();
    TestBed.tick();
    api.signedIn.set(false);
    TestBed.tick();
    expect(store.profile()).toBeNull();
    expect(store.lines()).toEqual([]);
    expect(store.address()).toBeNull();
  });
  describe('Home banners', () => {
    const live = () =>
      api.config.set({
        mode: 'live',
        apiBaseUrl: 'https://api.example.invalid/v1',
        supabaseUrl: 'https://auth.example.invalid',
        publishableKey: 'sb_publishable_example',
      });
    const banner = (extra: Record<string, unknown> = {}) => ({
      id: 'promo-1',
      eyebrow: 'Offer',
      headline: 'A trained phlebotomist comes to you',
      body: 'Book a home collection.',
      cta_label: 'Browse tests',
      target: { kind: 'tests', target_id: null, item: null },
      web_image_url: 'https://cdn.forumhospital.com/promos/banner-web.webp',
      ...extra,
    });

    it('reads them from the public Home feed without signing in', async () => {
      live();
      api.request.mockResolvedValue({ banners: [banner()], categories: [] });
      await store.loadBanners();
      expect(api.request).toHaveBeenCalledWith('/home', 'GET', undefined, undefined, false);
      expect(store.banners().map((b) => b.id)).toEqual(['promo-1']);
    });

    it('keeps only banners it can draw', async () => {
      live();
      api.request.mockResolvedValue({ banners: [banner(), banner({ id: 'x', headline: '' })] });
      await store.loadBanners();
      expect(store.banners().map((b) => b.id)).toEqual(['promo-1']);
    });

    it('shows none, quietly, when the Home feed fails', async () => {
      live();
      api.request.mockRejectedValue(new WebsiteError('http_503'));
      await store.loadBanners();
      expect(store.banners()).toEqual([]);
      expect(store.error()).toBe('');
    });

    it('drops banners that were showing when a later read fails', async () => {
      live();
      api.request.mockResolvedValueOnce({ banners: [banner()] });
      await store.loadBanners();
      expect(store.banners()).toHaveLength(1);
      api.request.mockRejectedValueOnce(new WebsiteError('network'));
      await store.loadBanners();
      expect(store.banners()).toEqual([]);
    });

    it('makes no request in preview, which has no API', async () => {
      await store.loadBanners();
      expect(api.request).not.toHaveBeenCalled();
      expect(store.banners()).toEqual([]);
    });
  });
});
