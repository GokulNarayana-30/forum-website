import { Injectable, computed, inject, signal, effect, untracked } from '@angular/core';
import { WebsiteApi, WebsiteError } from './api';
import {
  Address,
  Category,
  Detail,
  Item,
  Line,
  Order,
  Person,
  Quote,
  Report,
  Slot,
  SlotDay,
  Snapshot,
  itemPrice,
} from './models';
import { WebsiteClock } from './clock';
import { previewCatalog } from './preview-catalog';

interface Outcome {
  kind: string;
  snapshot?: Snapshot;
  order?: Order;
  current?: Quote;
  reason?: { kind: string };
}
interface Profile extends Person {
  email?: string;
  phone?: string;
  patient_id?: string;
  account_status?: string;
}
interface Attempt {
  key: string;
  owner: string;
  body: Record<string, unknown> | null;
}
@Injectable({ providedIn: 'root' })
export class WebsiteStore {
  readonly api = inject(WebsiteApi);
  private readonly clock = inject(WebsiteClock);
  readonly ready = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly message = signal('');
  readonly preview = computed(() => this.api.config().mode === 'preview');
  readonly items = signal<Item[]>(previewCatalog.items as Item[]);
  readonly categories = signal<Category[]>(previewCatalog.categories);
  readonly lines = signal<Line[]>([]);
  readonly people = signal<Person[]>([]);
  readonly addresses = signal<Address[]>([]);
  readonly profile = signal<Profile | null>(null);
  readonly quote = signal<Quote | null>(null);
  readonly priceChanged = signal(false);
  readonly snapshot = signal<Snapshot | null>(null);
  readonly days = signal<SlotDay[]>([]);
  readonly address = signal<Address | null>(null);
  readonly slot = signal<Slot | null>(null);
  readonly held = signal(false);
  readonly step = signal(0);
  readonly consent = signal(false);
  readonly preparationRead = signal(false);
  readonly orders = signal<Order[]>([]);
  readonly reports = signal<Report[]>([]);
  readonly documentLink = signal<{ url: string; expiresAt: number } | null>(null);
  readonly confirmed = signal<Order | null>(null);
  readonly previewComplete = signal(false);
  readonly demoSignedIn = signal(false);
  readonly terms = signal(false);
  readonly policy = signal('');
  readonly attempt = signal<Attempt | null>(null);
  readonly holdExpires = signal(0);
  readonly signedIn = computed(() => (this.preview() ? this.demoSignedIn() : this.api.signedIn()));
  readonly hasIssues = computed(() => !!this.snapshot()?.issues?.length);
  readonly total = computed(
    () => this.quote()?.to_pay_paise ?? this.lines().reduce((n, l) => n + l.price_paise, 0),
  );
  readonly canEdit = computed(() => !this.busy() && !this.attempt());
  private guestIds: string[] = [];
  private consentAt = '';

  constructor() {
    let wasSignedIn = false;
    effect(() => {
      const signed = this.api.signedIn();
      if (wasSignedIn && !signed) {
        untracked(() => this.clearPrivateState());
      }
      wasSignedIn = signed;
    });
  }
  private clearPrivateState(): void {
    this.profile.set(null);
    this.people.set([]);
    this.addresses.set([]);
    this.lines.set([]);
    this.snapshot.set(null);
    this.quote.set(null);
    this.address.set(null);
    this.slot.set(null);
    this.orders.set([]);
    this.reports.set([]);
    this.documentLink.set(null);
    this.confirmed.set(null);
    this.attempt.set(null);
    this.step.set(0);
    this.consent.set(false);
  }
  async run(action: () => Promise<void>): Promise<boolean> {
    if (this.busy()) return false;
    this.busy.set(true);
    this.error.set('');
    this.message.set('');
    try {
      await action();
      return true;
    } catch (e) {
      this.error.set(
        e instanceof WebsiteError
          ? e.message
          : 'We could not complete this request. Please try again.',
      );
      return false;
    } finally {
      this.busy.set(false);
    }
  }
  async initialize(callback = false): Promise<void> {
    if (callback) this.ready.set(false);
    await this.run(async () => {
      await this.api.configure();
      if (this.preview()) {
        this.ready.set(true);
        return;
      }
      this.items.set([]);
      this.categories.set([]);
      const [items, categories] = await Promise.all([
        this.api.request<Item[]>('/catalog/items', 'GET', undefined, undefined, false),
        this.api.request<Category[]>('/catalog/categories', 'GET', undefined, undefined, false),
      ]);
      if (
        !Array.isArray(items) ||
        !items.every(
          (i) =>
            typeof i.id === 'string' &&
            typeof i.name === 'string' &&
            Number.isInteger(i.mrp_paise) &&
            Array.isArray(i.category_ids),
        ) ||
        !Array.isArray(categories)
      )
        throw new WebsiteError('response');
      this.items.set(items);
      this.categories.set(categories);
      try {
        const ids = JSON.parse(sessionStorage.getItem('forum-web-guest') ?? '[]');
        if (Array.isArray(ids) && ids.every((id) => typeof id === 'string')) this.guestIds = ids;
      } catch {
        /* no persistent draft */
      }
      this.restoreGuestLines();
      if (callback) {
        await this.api.finishSignIn();
        await this.api.request('/me/consents/terms', 'PUT', {
          text_version: 'terms-2026-10-draft',
        });
        await this.loadAccount();
      } else if (await this.api.restoreSession()) {
        // A refresh keeps the visitor signed in: bring their account back the same way sign-in does.
        try {
          await this.loadAccount();
        } catch {
          if (this.api.signedIn())
            this.message.set('Your account could not be loaded. Refresh the page to try again.');
        }
      }
      this.ready.set(true);
    });
  }
  private restoreGuestLines(): void {
    this.lines.set(
      this.guestIds.flatMap((id) => {
        const item = this.items().find((i) => i.id === id);
        return item
          ? [
              {
                id: 'guest-' + id,
                item_id: id,
                item_name: item.name,
                person_id: 'me',
                price_paise: itemPrice(item),
                mrp_paise: item.mrp_paise,
                kind: item.kind,
              },
            ]
          : [];
      }),
    );
  }
  async detail(id: string): Promise<Detail> {
    if (!this.preview())
      return this.api.request<Detail>(
        '/catalog/items/' + encodeURIComponent(id),
        'GET',
        undefined,
        undefined,
        false,
      );
    const raw = previewCatalog.items.find((i) => i.id === id);
    if (!raw) throw new WebsiteError('not_found', 'This test could not be found.');
    return {
      item: raw as Item,
      description: raw.description,
      preparation: raw.preparation ?? [],
      parameters: raw.parameters ?? [],
      inclusions: raw.inclusions ?? [],
      faqs: raw.faqs ?? [],
    } as Detail;
  }
  async add(item: Item): Promise<void> {
    if (!this.canEdit()) return;
    await this.run(async () => {
      this.invalidate();
      if (this.preview() || !this.signedIn()) {
        if (this.lines().some((l) => l.item_id === item.id && l.person_id === 'me')) {
          this.message.set('This test is already in your cart for you.');
          return;
        }
        this.lines.update((ls) => [
          ...ls,
          {
            id: 'guest-' + item.id,
            item_id: item.id,
            item_name: item.name,
            person_id: 'me',
            price_paise: itemPrice(item),
            mrp_paise: item.mrp_paise,
            kind: item.kind,
          },
        ]);
        if (!this.preview()) {
          this.guestIds = this.lines().map((l) => l.item_id);
          sessionStorage.setItem('forum-web-guest', JSON.stringify(this.guestIds));
        }
      } else {
        await this.cartResult(
          await this.api.request<Outcome>('/cart/lines', 'POST', {
            item_id: item.id,
            person_id: 'me',
          }),
        );
      }
      this.message.set('Cart updated.');
    });
  }
  private applySnapshot(s: Snapshot): void {
    if (
      !s?.cart ||
      !Array.isArray(s.cart.lines) ||
      !s.cart.lines.every(
        (l) =>
          typeof l.id === 'string' &&
          typeof l.item_id === 'string' &&
          Number.isSafeInteger(l.price_paise),
      ) ||
      !Array.isArray(s.people)
    )
      throw new WebsiteError('response');
    this.snapshot.set(s);
    this.lines.set(s.cart.lines);
    this.people.set(s.people);
    const quote = s.quote?.quote ?? s.quote?.current ?? null;
    if (
      quote &&
      (typeof quote.quote_id !== 'string' ||
        !Number.isSafeInteger(quote.to_pay_paise) ||
        !Number.isFinite(Date.parse(quote.expires_at)))
    )
      throw new WebsiteError('response');
    this.quote.set(quote);
    this.priceChanged.set(s.quote?.kind === 'quote_price_changed');
  }
  private async cartResult(result: Outcome): Promise<void> {
    if (result.snapshot) {
      this.applySnapshot(result.snapshot);
      return;
    }
    const labels: Record<string, string> = {
      add_blocked_duplicate: 'This test is already assigned to this person.',
      add_blocked_not_eligible: 'This test is not eligible for the selected person.',
      add_needs_person_details:
        'Complete your date of birth and gender in Account before adding this test.',
    };
    throw new WebsiteError('cart', labels[result.kind] ?? 'The cart change was not accepted.');
  }
  async refreshCart(): Promise<void> {
    if (this.preview() || !this.signedIn()) return;
    const pin = this.address()?.pincode;
    this.applySnapshot(
      await this.api.request<Snapshot>('/cart/snapshot' + (pin ? '?pincode=' + pin : '')),
    );
  }
  async remove(line: Line): Promise<void> {
    if (!this.canEdit()) return;
    await this.run(async () => {
      this.invalidate();
      if (this.preview() || !this.signedIn()) {
        this.lines.update((ls) => ls.filter((l) => l.id !== line.id));
        if (!this.preview()) {
          this.guestIds = this.lines().map((l) => l.item_id);
          sessionStorage.setItem('forum-web-guest', JSON.stringify(this.guestIds));
        }
      } else
        this.applySnapshot(
          await this.api.request<Snapshot>('/cart/lines/' + encodeURIComponent(line.id), 'DELETE'),
        );
    });
  }
  async assign(line: Line, id: string): Promise<void> {
    if (!this.canEdit()) return;
    await this.run(async () => {
      this.invalidate();
      if (this.preview()) {
        if (
          this.lines().some(
            (l) => l.id !== line.id && l.item_id === line.item_id && l.person_id === id,
          )
        )
          throw new WebsiteError('duplicate', 'This person already has this test.');
        this.lines.update((ls) => ls.map((l) => (l.id === line.id ? { ...l, person_id: id } : l)));
      } else
        await this.cartResult(
          await this.api.request<Outcome>(
            '/cart/lines/' + encodeURIComponent(line.id) + '/person',
            'PUT',
            { person_id: id },
          ),
        );
    });
  }
  async signIn(): Promise<void> {
    if (!this.terms()) {
      this.error.set('Please accept the terms and privacy notice to continue.');
      return;
    }
    await this.run(async () => {
      if (this.preview()) {
        this.demoSignedIn.set(true);
        this.people.set([
          {
            id: 'me',
            name: 'Sample customer',
            relation: 'self',
            date_of_birth: '1990-01-01',
            gender: 'male',
          },
          {
            id: 'sample-family',
            name: 'Sample family member',
            relation: 'spouse',
            date_of_birth: '1992-01-01',
            gender: 'female',
          },
        ]);
        this.addresses.set([
          {
            id: 'sample-home',
            type: 'home',
            house: 'Sample home',
            area: 'Sample collection area',
            pincode: '560068',
          },
        ]);
        this.profile.set({ id: 'sample-account', name: 'Sample customer', relation: 'self' });
      } else await this.api.signIn();
    });
  }
  private async loadAccount(): Promise<void> {
    const p = await this.api.request<Profile>('/me');
    this.profile.set(p);
    const [family, addresses, policy] = await Promise.all([
      this.api.request<Person[]>('/me/family'),
      this.api.request<Address[]>('/me/addresses'),
      this.api.request<{ cancellation_policy: string }>('/checkout/policy'),
    ]);
    this.people.set([{ ...p, id: 'me', relation: 'self' }, ...family]);
    this.addresses.set(addresses);
    this.policy.set(policy.cancellation_policy);
    // Guest selections are removed one at a time only after a confirmed server outcome.
    for (const id of [...this.guestIds]) {
      const r = await this.api.request<Outcome>('/cart/lines', 'POST', {
        item_id: id,
        person_id: 'me',
      });
      if (!['added_to_cart', 'add_blocked_duplicate'].includes(r.kind)) break;
      this.guestIds = this.guestIds.filter((x) => x !== id);
      sessionStorage.setItem('forum-web-guest', JSON.stringify(this.guestIds));
    }
    await this.refreshCart();
    try {
      const a = JSON.parse(sessionStorage.getItem('forum-web-attempt') ?? 'null') as Attempt | null;
      if (a?.owner === p.id && typeof a.key === 'string') this.attempt.set({ ...a, body: null });
    } catch {
      /* invalid attempt ignored */
    }
    if (this.guestIds.length)
      this.message.set(
        'Some guest selections need your profile details before they can be added. Complete your Account details, then add them again.',
      );
  }
  signOut(): void {
    if (this.busy()) return;
    this.api.clearSession();
    this.demoSignedIn.set(false);
    this.profile.set(null);
    this.people.set([]);
    this.addresses.set([]);
    this.lines.set([]);
    this.snapshot.set(null);
    this.quote.set(null);
    this.address.set(null);
    this.slot.set(null);
    this.orders.set([]);
    this.reports.set([]);
    this.documentLink.set(null);
    this.confirmed.set(null);
    this.attempt.set(null);
    this.step.set(0);
    this.consent.set(false);
    this.terms.set(false);
    this.error.set('');
    this.message.set('You have signed out.');
  }
  private invalidate(): void {
    this.quote.set(null);
    this.consent.set(false);
    this.consentAt = '';
    this.previewComplete.set(false);
  }
  async chooseAddress(id: string): Promise<void> {
    if (!this.canEdit()) return;
    this.address.set(this.addresses().find((a) => a.id === id) ?? null);
    this.slot.set(null);
    this.held.set(false);
    this.days.set([]);
    this.preparationRead.set(false);
    this.invalidate();
    await this.run(async () => {
      const a = this.address();
      if (!a) return;
      if (this.preview()) {
        // Fixed fixture dates are labelled as examples and never indicate real availability.
        this.days.set([
          {
            day_key: 'Example day',
            slots: [
              {
                id: 'sample-0700',
                starts_at: '2026-11-05T07:00:00+05:30',
                ends_at: '2026-11-05T08:00:00+05:30',
                capacity_left: 2,
                best_for_fasting: true,
              },
              {
                id: 'sample-0900',
                starts_at: '2026-11-05T09:00:00+05:30',
                ends_at: '2026-11-05T10:00:00+05:30',
                capacity_left: 1,
                best_for_fasting: false,
              },
            ],
          },
        ]);
        return;
      }
      const service = await this.api.request<{ serviceable: boolean }>(
        '/serviceability/' + a.pincode,
        'GET',
        undefined,
        undefined,
        false,
      );
      if (!service.serviceable)
        throw new WebsiteError(
          'unserviceable',
          'Home collection is not available at this pincode. Choose another address.',
        );
      this.days.set(
        await this.api.request<SlotDay[]>(
          '/slots?pincode=' + a.pincode,
          'GET',
          undefined,
          undefined,
          false,
        ),
      );
      await this.refreshCart();
    });
  }
  async chooseSlot(slot: Slot): Promise<void> {
    if (!this.canEdit() || slot.capacity_left < 1) return;
    await this.run(async () => {
      this.invalidate();
      this.slot.set(null);
      this.held.set(false);
      if (this.preview()) {
        this.slot.set(slot);
        this.held.set(true);
        return;
      }
      const r = await this.api.request<{ kind: string; expires_at?: string }>(
        '/slots/' + encodeURIComponent(slot.id) + '/hold',
        'POST',
      );
      if (r.kind !== 'slot_held')
        throw new WebsiteError(
          'slot_taken',
          'That slot is no longer available. Choose another time.',
        );
      this.slot.set(slot);
      this.held.set(true);
      this.holdExpires.set(Date.parse(r.expires_at ?? ''));
      await this.refreshCart();
    });
  }
  async next(): Promise<boolean> {
    if (this.busy() || this.attempt()) return false;
    const index = this.step();
    if (index === 0 && (!this.lines().length || this.hasIssues())) {
      this.error.set('Resolve the cart warnings before continuing.');
      return false;
    }
    if (index === 1 && (!this.address() || !this.days().some((d) => d.slots.length))) {
      this.error.set('Choose an address with collection availability.');
      return false;
    }
    if (index === 2 && (!this.slot() || !this.held())) {
      this.error.set('Choose an available collection slot.');
      return false;
    }
    if (index === 3 && !this.preparationRead()) {
      this.error.set('Please confirm you have read the preparation instructions.');
      return false;
    }
    if (index === 4 && !this.preview()) {
      const ok = await this.run(() => this.refreshCart());
      if (!ok) return false;
    }
    this.error.set('');
    this.step.set(Math.min(5, index + 1));
    return true;
  }
  back(): void {
    if (this.canEdit()) {
      this.step.update((i) => Math.max(0, i - 1));
      this.consent.set(false);
    }
  }
  async coupon(code: string): Promise<void> {
    if (!this.canEdit()) return;
    await this.run(async () => {
      this.invalidate();
      if (this.preview()) {
        this.message.set(
          'Coupons are checked by Forum when live booking is connected. No discount has been applied in this preview.',
        );
        return;
      }
      const r = await this.api.request<Outcome>(
        '/cart/coupon',
        code.trim() ? 'PUT' : 'DELETE',
        code.trim() ? { code: code.trim() } : undefined,
      );
      if (r.snapshot) this.applySnapshot(r.snapshot);
      if (r.kind !== 'coupon_applied' && r.kind !== 'coupon_removed')
        throw new WebsiteError(
          'coupon',
          'This coupon could not be applied. Check its conditions or continue without it.',
        );
    });
  }
  async acceptPrice(): Promise<void> {
    await this.run(async () => {
      const q = this.quote();
      if (!q) return;
      const r = await this.api.request<{ kind: string; quote?: Quote; current?: Quote }>(
        '/cart/price-change-acceptances',
        'POST',
        { current_quote_id: q.quote_id },
      );
      this.quote.set(r.quote ?? r.current ?? null);
      this.priceChanged.set(r.kind !== 'quote_ok');
      this.consent.set(false);
    });
  }
  setConsent(value: boolean): void {
    if (!this.attempt()) {
      this.consent.set(value);
      this.consentAt = value ? this.clock.iso() : '';
    }
  }
  async place(): Promise<boolean> {
    return this.run(async () => {
      if (this.preview()) {
        if (
          !this.consent() ||
          !this.preparationRead() ||
          !this.slot() ||
          !this.address() ||
          !this.lines().length
        )
          throw new WebsiteError(
            'incomplete',
            'Complete the steps and consent before finishing the preview.',
          );
        this.previewComplete.set(true);
        return;
      }
      let a = this.attempt();
      if (!a) {
        const q = this.quote(),
          address = this.address(),
          slot = this.slot(),
          profile = this.profile();
        if (
          !this.signedIn() ||
          !profile ||
          !q ||
          !address ||
          !slot ||
          !this.consent() ||
          !this.consentAt ||
          !this.preparationRead() ||
          !this.held() ||
          this.hasIssues() ||
          this.priceChanged()
        )
          throw new WebsiteError(
            'incomplete',
            'Complete checkout and accept the current quote before booking.',
          );
        if (
          Date.parse(q.expires_at) <= this.clock.now() ||
          this.holdExpires() <= this.clock.now()
        ) {
          await this.refreshCart();
          this.consent.set(false);
          this.held.set(false);
          this.step.set(2);
          throw new WebsiteError(
            'expired',
            'Your quote or slot hold has expired. Choose a slot again and review the current total.',
          );
        }
        const key = 'chk_' + crypto.randomUUID().replaceAll('-', '');
        a = {
          key,
          owner: profile.id,
          body: {
            checkout_attempt_id: key,
            cart_id: q.cart_id,
            quote_id: q.quote_id,
            address_id: address.id,
            address_pincode: address.pincode,
            slot_id: slot.id,
            coupon_code: q.applied_coupon?.code ?? null,
            consent: {
              diagnostic_accepted: true,
              marketing_accepted: false,
              text_version: 'consent-2026-10-draft',
              accepted_at: this.consentAt,
            },
          },
        };
        sessionStorage.setItem('forum-web-attempt', JSON.stringify({ key: a.key, owner: a.owner }));
        this.attempt.set(a);
      }
      // Freeze both payload and key after an uncertain response. Edits remain blocked until resolved.
      const found = await this.api.request<Order | null>(
        '/checkout/attempts/' + encodeURIComponent(a.key) + '/order',
      );
      if (found) {
        this.finishOrder(found);
        return;
      }
      if (!a.body)
        throw new WebsiteError(
          'pending',
          'We have not found a confirmed booking for this earlier attempt. Check My bookings or contact Forum before starting another booking.',
        );
      const result = await this.api.request<Outcome>('/orders', 'POST', a.body, a.key);
      if (result.kind === 'order_placed' && result.order) {
        this.finishOrder(result.order);
        return;
      }
      this.clearAttempt();
      this.consent.set(false);
      if (result.kind === 'price_changed' && result.current) {
        this.quote.set(result.current);
        this.priceChanged.set(true);
      }
      if (result.kind === 'slot_unavailable') {
        this.slot.set(null);
        this.held.set(false);
        this.step.set(2);
      }
      const refusal: Record<string, string> = {
        slot_unavailable: 'Your selected slot is no longer available. Choose another time.',
        price_changed: 'Your total has changed. Review and accept the updated amount.',
        not_serviceable: 'Collection is not available at this address.',
        mobile_required: 'Add your +91 mobile number in Account to continue.',
        mobile_not_verified:
          'Your mobile number requires verification. Please contact Forum support.',
        too_many_open_bookings:
          'You have reached the limit for upcoming unpaid bookings. Check My bookings.',
        deletion_pending: 'This account is pending deletion and cannot place bookings.',
        coupon_exhausted: 'This coupon is no longer available. Remove it and review your total.',
      };
      throw new WebsiteError(
        result.kind,
        refusal[result.kind] ??
          'The booking was not placed. Refresh your cart and review your details.',
      );
    });
  }
  private clearAttempt(): void {
    this.attempt.set(null);
    sessionStorage.removeItem('forum-web-attempt');
  }
  private finishOrder(o: Order): void {
    if (
      typeof o.id !== 'string' ||
      typeof o.booking_ref !== 'string' ||
      !Number.isSafeInteger(o.total_paise)
    )
      throw new WebsiteError('response');
    this.confirmed.set(o);
    this.lines.set([]);
    this.quote.set(null);
    this.snapshot.set(null);
    this.clearAttempt();
    this.step.set(0);
    this.slot.set(null);
    this.address.set(null);
    this.held.set(false);
    this.consent.set(false);
    this.preparationRead.set(false);
  }
  async loadOrders(): Promise<void> {
    await this.run(async () => {
      if (this.preview()) {
        this.orders.set([]);
        return;
      }
      this.orders.set(await this.api.request<Order[]>('/orders'));
    });
  }
  async loadReports(): Promise<void> {
    await this.run(async () => {
      if (this.preview()) {
        this.reports.set([]);
        this.documentLink.set(null);
        return;
      }
      this.reports.set(await this.api.request<Report[]>('/reports'));
    });
  }
  async openReport(report: Report): Promise<void> {
    await this.run(async () => {
      if (this.preview()) return;
      const link = await this.api.request<{ source: string; expires_at: string; version: number }>(
        '/reports/' + encodeURIComponent(report.id) + '/document-links',
        'POST',
      );
      const u = new URL(link.source);
      if (u.protocol !== 'https:' || !(Date.parse(link.expires_at) > this.clock.now()))
        throw new WebsiteError('link', 'The report link has expired. Please try again.');
      await this.api.request('/reports/' + encodeURIComponent(report.id) + '/access-log', 'POST', {
        kind: 'viewed',
        version: link.version,
      });
      this.documentLink.set({ url: u.toString(), expiresAt: Date.parse(link.expires_at) });
    });
  }
  checkDocument(event: Event): void {
    const link = this.documentLink();
    if (!link || link.expiresAt <= this.clock.now()) {
      event.preventDefault();
      this.documentLink.set(null);
      this.error.set('Your report link has expired. Request a fresh link.');
    }
  }
  async saveProfile(name: string, dob: string, gender: string, phone: string): Promise<void> {
    if (this.preview()) return;
    await this.run(async () => {
      const p = await this.api.request<Profile>('/me', 'PATCH', {
        name,
        email: this.profile()?.['email'] ?? null,
        date_of_birth: dob,
        gender,
      });
      this.profile.set(p);
      if (phone) await this.api.request('/me/mobile', 'PUT', { phone });
      await this.loadAccount();
    });
  }
  async addFamily(data: Record<string, unknown>): Promise<void> {
    if (this.preview()) return;
    await this.run(async () => {
      await this.api.request('/me/family', 'POST', data, 'fam_' + crypto.randomUUID());
      await this.loadAccount();
    });
  }
  async addAddress(data: Record<string, unknown>): Promise<void> {
    if (this.preview()) return;
    await this.run(async () => {
      await this.api.request('/me/addresses', 'POST', data, 'addr_' + crypto.randomUUID());
      this.addresses.set(await this.api.request<Address[]>('/me/addresses'));
    });
  }
}
