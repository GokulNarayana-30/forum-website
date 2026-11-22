import { isPlatformBrowser } from '@angular/common';
import {
  Component,
  PLATFORM_ID,
  RESPONSE_INIT,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Title, Meta } from '@angular/platform-browser';
import { SafeSignInReturn, safeSignInReturn } from '../core/api';
import { WebsiteStore } from '../core/store';
import { SupportChatService } from '../core/support-chat.service';
import {
  Detail,
  Item,
  Order,
  image,
  itemImage,
  instant,
  itemPrice,
  money,
  steps,
  CHECKOUT_STEP,
  groupSlotsByPeriod,
  istDayKey,
  slotDayLabel,
  slotTimeRange,
} from '../core/models';
import { Summary } from './summary';
import { BookingStatus } from './booking-status';
import { Account } from './account';
import { PhoneCode } from './phone-code';
import { FastingDialog } from './fasting-dialog';
@Component({
  selector: 'forum-journey',
  imports: [FormsModule, RouterLink, Summary, BookingStatus, Account, PhoneCode, FastingDialog],
  templateUrl: './journey.html',
  styleUrl: './journey.scss',
})
export class Journey {
  protected readonly store = inject(WebsiteStore);
  private readonly chat = inject(SupportChatService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  // Only set while the server renders a page; the browser has no response to change.
  private readonly responseInit = inject(RESPONSE_INIT, { optional: true });
  protected readonly view = signal('');
  protected readonly nextReturn = signal<SafeSignInReturn | null>(null);
  protected readonly detail = signal<Detail | null>(null);
  protected readonly detailLoading = signal(false);
  protected readonly query = signal('');
  protected readonly category = signal('');
  protected readonly kind = signal('');
  protected readonly sort = signal('popular');
  protected readonly fasting = signal('');
  protected readonly filtersOpen = signal(false);
  protected readonly activeFilters = computed(
    () => Number(!!this.kind()) + Number(!!this.fasting()) + Number(this.sort() !== 'popular'),
  );
  protected readonly money = money;
  protected readonly instant = instant;
  protected readonly image = image;
  protected readonly itemImage = itemImage;
  protected readonly itemPrice = itemPrice;
  protected readonly steps = steps;
  protected readonly STEP = CHECKOUT_STEP;
  /** The fasting popup (owner, 2026-11-22): opens by itself on the time step of a fasting booking. */
  protected readonly fastingOpen = signal(false);
  protected readonly fastingHours = computed(() => {
    const preparation = this.store.snapshot()?.preparation;
    if (preparation) return { min: preparation.fasting_hours_min ?? null, max: preparation.fasting_hours_max ?? null };
    const fasting = this.store
      .lines()
      .map((line) => this.store.items().find((item) => item.id === line.item_id))
      .filter((item) => item?.fasting_required);
    const mins = fasting.map((item) => item?.fasting_hours_min ?? 0).filter(Boolean);
    const maxes = fasting.map((item) => item?.fasting_hours_max ?? 0).filter(Boolean);
    return { min: mins.length ? Math.max(...mins) : null, max: maxes.length ? Math.max(...maxes) : null };
  });
  protected fastingHoursShort(): string {
    const { min, max } = this.fastingHours();
    if (min && max && max > min) return `${min}–${max} hours`;
    return min || max ? `at least ${min || max} hours` : 'as the lab instructs';
  }
  protected acknowledgeFasting(): void {
    this.store.preparationRead.set(true);
    this.fastingOpen.set(false);
  }
  protected readonly slotTimeRange = slotTimeRange;
  /** The day tab the customer picked; until then the held slot's day or the first day with open times. */
  protected readonly chosenDay = signal<string | null>(null);
  protected readonly slotDays = computed(() => {
    const today = istDayKey(Date.now());
    return this.store.days().map((day) => ({
      key: day.day_key,
      ...slotDayLabel(day.day_key, today),
      open: day.slots.filter((slot) => slot.capacity_left > 0).length,
      groups: groupSlotsByPeriod(day.slots),
    }));
  });
  protected readonly activeDay = computed(() => {
    const days = this.slotDays();
    const held = this.store.slot();
    const heldDay = held
      ? days.find((day) => day.groups.some((group) => group.slots.some((slot) => slot.id === held.id)))?.key
      : undefined;
    const key = this.chosenDay() ?? heldDay;
    return days.find((day) => day.key === key) ?? days.find((day) => day.open > 0) ?? days[0] ?? null;
  });
  protected couponCode = '';
  protected paymentEmail = '';
  protected readonly selectedOrder = signal<Order | null>(null);
  protected readonly filtered = computed(() => {
    const search = this.query().trim().toLowerCase();
    let items = this.store
      .items()
      .filter(
        (i) =>
          (!this.category() || i.category_ids.includes(this.category())) &&
          (!this.kind() || i.kind === this.kind()) &&
          (!this.fasting() ||
            (this.fasting() === 'yes'
              ? i.fasting_required === true
              : i.fasting_required === false)) &&
          (!search || `${i.name} ${i.id}`.toLowerCase().includes(search)),
      );
    if (this.sort() === 'price-low') items = items.sort((a, b) => itemPrice(a) - itemPrice(b));
    if (this.sort() === 'price-high') items = items.sort((a, b) => itemPrice(b) - itemPrice(a));
    return items;
  });
  private detailSequence = 0;
  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      this.query.set(params.get('q') ?? '');
      this.category.set(params.get('category') ?? '');
      this.nextReturn.set(safeSignInReturn(params.get('next')));
    });
    this.route.data.pipe(takeUntilDestroyed()).subscribe((d) => {
      this.view.set(d['view']);
      // An unknown address still shows the helpful page, but search engines must see a 404.
      if (d['view'] === 'not-found' && this.responseInit) this.responseInit.status = 404;
      if (d['detail']) {
        this.detail.set(d['detail']);
        this.title.setTitle(d['detail'].item.name + ' | Forum Labs');
        this.meta.updateTag({
          name: 'description',
          content: d['detail'].description ?? d['detail'].item.name,
        });
      }
    });
    effect(() => {
      const ready = this.store.ready(),
        signed = this.store.signedIn(),
        view = this.view();
      untracked(() => {
        if (!ready) return;

        if (signed && view === 'bookings') void this.store.loadOrders();
        if (signed && view === 'reports') void this.store.loadReports();
        if (signed && ['cart', 'checkout'].includes(view))
          void this.store.run(() => this.store.refreshCart());
        if (isPlatformBrowser(this.platformId) && view === 'help' && this.chat.canConnectLive())
          void this.chat.refreshUnread();
      });
    });
    effect(() => {
      const view = this.view();
      this.meta.updateTag({
        name: 'robots',
        content: ['tests', 'detail'].includes(view) ? 'index,follow' : 'noindex,nofollow',
      });
    });
    // Open the fasting popup once on the time step of a fasting booking, until it is read.
    effect(() => {
      const open =
        this.view() === 'checkout' &&
        this.store.step() === CHECKOUT_STEP.slot &&
        this.store.needsFasting() &&
        !this.store.preparationRead();
      if (open && isPlatformBrowser(this.platformId)) untracked(() => this.fastingOpen.set(true));
    });
    effect(() => {
      const signedIn = this.store.signedIn();
      const view = this.view();
      if (!signedIn || view !== 'bookings') this.selectedOrder.set(null);
      if (!signedIn || view !== 'checkout') this.paymentEmail = '';
    });
  }
  protected contains(item: Item): boolean {
    return this.store.lines().some((l) => l.item_id === item.id && l.person_id === 'me');
  }
  protected categoryName(id: string): string {
    return this.store.categories().find((c) => c.id === id)?.name ?? 'Lab test';
  }
  protected async loadDetail(): Promise<void> {
    const seq = ++this.detailSequence;
    this.detail.set(null);
    this.detailLoading.set(true);
    try {
      const d = await this.store.detail(this.route.snapshot.paramMap.get('id') ?? '');
      if (seq === this.detailSequence) {
        this.detail.set(d);
        this.title.setTitle(d.item.name + ' | Forum Labs');
        this.meta.updateTag({ name: 'description', content: d.description ?? d.item.name });
      }
    } catch {
      this.store.error.set('This test could not be loaded. Please try again.');
    } finally {
      if (seq === this.detailSequence) this.detailLoading.set(false);
    }
  }
  protected async checkout(): Promise<void> {
    if (!this.store.lines().length) return;
    await this.router.navigateByUrl(this.store.signedIn() ? '/checkout' : '/sign-in');
  }
  protected async signIn(): Promise<void> {
    const next = this.nextReturn();
    await this.store.signIn(next);
    if (this.store.signedIn()) await this.afterSignIn();
  }
  /** After a mobile or sample sign-in: a new account adds its details first, then the visitor goes on. */
  protected async afterSignIn(): Promise<void> {
    if (this.store.needsDetails()) {
      this.store.message.set(
        'Welcome! Add your name and details to finish setting up your account.',
      );
      await this.router.navigateByUrl('/account');
      return;
    }
    await this.router.navigateByUrl(this.nextReturn() ?? '/checkout');
  }
  protected async place(): Promise<void> {
    const ok = await this.store.place(this.paymentEmail);
    if (!ok) return;
    this.paymentEmail = '';
    const payment = this.store.paymentOrder();
    if (payment) {
      if (this.store.initialPayuFeedback()?.kind !== 'redirected') {
        await this.router.navigate(['/payment-status'], { queryParams: { order: payment.id } });
      }
      return;
    }
    if (this.store.previewComplete() || this.store.confirmed())
      await this.router.navigateByUrl('/confirmation');
  }
  private focusStep(): void {
    const heading = document.getElementById('checkout-step-heading');
    heading?.focus({ preventScroll: true });
    heading?.scrollIntoView({ block: 'start' });
  }
  protected async next(): Promise<void> {
    if (await this.store.next()) this.focusStep();
  }
  protected back(): void {
    this.store.back();
    this.focusStep();
  }
  protected closeFilters(trigger: HTMLButtonElement): void {
    this.filtersOpen.set(false);
    trigger.focus();
  }
}
