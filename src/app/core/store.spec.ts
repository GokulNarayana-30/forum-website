import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { WebsiteStore } from './store';
import { WebsiteApi, WebsiteError } from './api';
import { WebsiteClock } from './clock';
import { CHECKOUT_STEP, Config, Order, steps } from './models';

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
  it('has three steps: patients & address, collection time, coupon & review', () => {
    expect(steps).toEqual(['Patients & address', 'Collection time', 'Coupon & review']);
    expect(CHECKOUT_STEP).toEqual({ people: 0, slot: 1, review: 2 });
  });
  it('leaves patients & address only with an address that has collection times', async () => {
    store.terms.set(true);
    await store.signIn();
    await store.add(store.items()[0]);
    expect(await store.next()).toBe(false);
    expect(store.step()).toBe(CHECKOUT_STEP.people);
    await store.chooseAddress('sample-home');
    expect(await store.next()).toBe(true);
    expect(store.step()).toBe(CHECKOUT_STEP.slot);
  });
  it('leaves slot & preparation only with a held slot and the preparation read', async () => {
    store.terms.set(true);
    await store.signIn();
    await store.add(store.items()[0]);
    await store.chooseAddress('sample-home');
    store.step.set(CHECKOUT_STEP.slot);
    expect(await store.next()).toBe(false);
    await store.chooseSlot(store.days()[0].slots[0]);
    expect(await store.next()).toBe(false);
    expect(store.step()).toBe(CHECKOUT_STEP.slot);
    store.preparationRead.set(true);
    expect(await store.next()).toBe(true);
    expect(store.step()).toBe(CHECKOUT_STEP.review);
    expect(await store.next()).toBe(true);
    expect(store.step()).toBe(CHECKOUT_STEP.review);
  });
  // Owner, 2026-11-22: preparation matters only when a test needs fasting.
  it('a booking with no fasting test needs no preparation tick to continue or to book', async () => {
    liveCheckout();
    store.preparationRead.set(false);
    store.snapshot.set({ preparation: { fasting_required: false, instructions: [] } } as never);
    expect(store.needsFasting()).toBe(false);
    store.step.set(CHECKOUT_STEP.slot);
    api.request.mockResolvedValue({ cart: { id: 'cart-a', lines: store.lines() }, people: [], quote: store.quote() });
    expect(await store.next()).toBe(true);
    expect(store.step()).toBe(CHECKOUT_STEP.review);
  });
  it('a fasting booking still needs the fasting note acknowledged before it continues', async () => {
    liveCheckout();
    store.preparationRead.set(false);
    store.snapshot.set({ preparation: { fasting_required: true, fasting_hours_min: 10, fasting_hours_max: 12 } } as never);
    expect(store.needsFasting()).toBe(true);
    store.step.set(CHECKOUT_STEP.slot);
    expect(await store.next()).toBe(false);
    expect(store.step()).toBe(CHECKOUT_STEP.slot);
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
  const pendingOrder: Order = {
    ...order,
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    status: 'payment_pending',
    payment_status: 'payment_pending',
  };

  it('preselects PayU when policy enables it, and Skip launches without saving an email', async () => {
    liveCheckout();
    store.onlinePaymentEnabled.set(true);
    expect(store.paymentChoice()).toBe('payu');
    api.request
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ kind: 'order_placed', order: pendingOrder })
      .mockResolvedValueOnce({ kind: 'payu_checkout_pending' });
    expect(await store.place()).toBe(true);
    expect(api.request.mock.calls[1][2]).toHaveProperty('payment_choice', 'payu');
    expect(api.request.mock.calls[2]).toEqual([
      `/orders/${pendingOrder.id}/payu/attempts`,
      'POST',
      undefined,
      expect.any(String),
    ]);
    expect(
      api.request.mock.calls.some(([path, method]) => path === '/me' && method === 'PATCH'),
    ).toBe(false);
    expect(store.confirmed()).toBeNull();
    expect(store.paymentOrder()?.id).toBe(pendingOrder.id);
  });

  it('saves an optional email with the full profile and prompts only for the email refusal', async () => {
    liveCheckout();
    store.onlinePaymentEnabled.set(true);
    store.profile.set({
      id: 'owner-a',
      name: 'Account name',
      relation: 'self',
      date_of_birth: '1999-01-01',
      gender: 'female',
    });
    api.request.mockRejectedValueOnce(new WebsiteError('payu_email_required'));
    expect(await store.startPayu(pendingOrder.id)).toBe('email_required');
    expect(api.request).toHaveBeenCalledTimes(1);
    api.request
      .mockResolvedValueOnce({ ...store.profile(), email: 'payer@example.test' })
      .mockResolvedValueOnce({ kind: 'payu_checkout_pending' });
    expect(await store.startPayu(pendingOrder.id, ' payer@example.test ')).toBe('checking');
    expect(api.request.mock.calls[1]).toEqual([
      '/me',
      'PATCH',
      {
        name: 'Account name',
        email: 'payer@example.test',
        date_of_birth: '1999-01-01',
        gender: 'female',
      },
    ]);
  });

  it('offers only collection payment for an unknown or zero total and recovers from a disabled PayU choice', async () => {
    liveCheckout();
    expect(store.paymentChoice()).toBe('pay_at_collection');
    store.onlinePaymentEnabled.set(true);
    const quote = store.quote()!;
    store.quote.set({ ...quote, to_pay_paise: 0 });
    expect(store.paymentChoice()).toBe('pay_at_collection');
    store.quote.set(quote);
    api.request
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new WebsiteError('payment_choice_unavailable'));
    expect(await store.place()).toBe(false);
    expect(store.paymentChoice()).toBe('pay_at_collection');
    expect(store.attempt()).toBeNull();
  });

  it('switches the same order through the keyed API without posting another booking', async () => {
    liveCheckout();
    api.request.mockResolvedValueOnce({ kind: 'payu_checkout_pending' });
    expect(await store.switchPayu(pendingOrder.id)).toBe('payu_checkout_pending');
    expect(api.request).toHaveBeenCalledExactlyOnceWith(
      `/orders/${pendingOrder.id}/payu/switch`,
      'POST',
      undefined,
      expect.any(String),
    );
  });

  it('recovers an existing pending booking without starting another session', async () => {
    liveCheckout();
    store.onlinePaymentEnabled.set(true);
    api.request
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new WebsiteError('network'))
      .mockResolvedValueOnce(pendingOrder);
    expect(await store.place()).toBe(false);
    store.onlinePaymentEnabled.set(false);
    expect(await store.place()).toBe(true);
    expect(store.paymentOrder()?.id).toBe(pendingOrder.id);
    expect(api.request.mock.calls.filter((call) => call[1] === 'POST')).toHaveLength(1);
    expect(api.request.mock.calls[1][2]).toHaveProperty('payment_choice', 'payu');
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
    expect(store.step()).toBe(CHECKOUT_STEP.slot);
  });
  it('never labels a slot refusal as a confirmed booking', async () => {
    liveCheckout();
    api.request.mockResolvedValueOnce(null).mockResolvedValueOnce({ kind: 'slot_unavailable' });
    expect(await store.place()).toBe(false);
    expect(store.confirmed()).toBeNull();
    expect(store.slot()).toBeNull();
    expect(store.step()).toBe(CHECKOUT_STEP.slot);
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
