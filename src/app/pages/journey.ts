import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Title, Meta } from '@angular/platform-browser';
import { WebsiteStore } from '../core/store';
import { Detail, Item, Order, image, instant, itemPrice, money, steps } from '../core/models';
import { Summary } from './summary';
import { BookingStatus } from './booking-status';
@Component({
  selector: 'forum-journey',
  imports: [FormsModule, RouterLink, Summary, BookingStatus],
  templateUrl: './journey.html',
  styleUrl: './journey.scss',
})
export class Journey {
  protected readonly store = inject(WebsiteStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  protected readonly view = signal('');
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
  protected readonly itemPrice = itemPrice;
  protected readonly steps = steps;
  protected couponCode = '';
  protected name = '';
  protected dob = '';
  protected gender = '';
  protected phone = '';
  protected familyName = '';
  protected familyDob = '';
  protected familyGender = '';
  protected relation = 'spouse';
  protected share = false;
  protected guardian = false;
  protected house = '';
  protected street = '';
  protected area = '';
  protected pincode = '';
  protected addressType = 'home';
  protected landmark = '';
  protected accessNotes = '';
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
    });
    this.route.data.pipe(takeUntilDestroyed()).subscribe((d) => {
      this.view.set(d['view']);
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
        if (view === 'account') {
          const p = this.store.profile();
          this.name = p?.name ?? '';
          this.dob = p?.date_of_birth ?? '';
          this.gender = p?.gender ?? '';
          this.phone = p?.phone ?? '';
        }
      });
    });
    effect(() => {
      const view = this.view();
      this.meta.updateTag({
        name: 'robots',
        content: ['tests', 'detail'].includes(view) ? 'index,follow' : 'noindex,nofollow',
      });
    });
    effect(() => {
      if (!this.store.signedIn() || this.view() !== 'bookings') this.selectedOrder.set(null);
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
    await this.store.signIn();
    if (this.store.signedIn()) await this.router.navigateByUrl('/checkout');
  }
  protected async place(): Promise<void> {
    const ok = await this.store.place();
    if (ok && (this.store.previewComplete() || this.store.confirmed()))
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

  protected addFamily(): void {
    void this.store.addFamily({
      name: this.familyName,
      relation: this.relation,
      date_of_birth: this.familyDob,
      gender: this.familyGender,
      share_consent: this.share,
      guardian_confirmed: this.guardian,
    });
  }
  protected addAddress(): void {
    void this.store.addAddress({
      type: this.addressType,
      house: this.house,
      street: this.street,
      area: this.area,
      pincode: this.pincode,
      landmark: this.landmark,
      access_notes: this.accessNotes,
    });
  }
  protected saveProfile(): void {
    void this.store.saveProfile(this.name, this.dob, this.gender, this.phone);
  }
}
