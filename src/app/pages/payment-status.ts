import { isPlatformBrowser } from '@angular/common';
import {
  Component,
  DestroyRef,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Meta } from '@angular/platform-browser';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  instant,
  money,
  Order,
  paymentOrderId,
  slotTimeRange,
  PaymentStatusView,
  PayuLaunch,
  refundProgressText,
} from '../core/models';
import { WebsiteStore } from '../core/store';

const MAX_CHECKS = 8;
/** While the server confirms PayU's reply with its own check: up to two minutes. */
const MAX_PROCESSING_CHECKS = 40;
const POLL_MS = 3000;

@Component({
  selector: 'forum-payment-status',
  imports: [RouterLink, FormsModule],
  template: `
    <section
      class="pay-card"
      [class.embedded]="embedded()"
      aria-label="Payment status"
      aria-live="polite"
    >
      @if (!embedded()) {
        <div class="pay-icon" [class]="'pay-icon ' + tone()" aria-hidden="true">
          @switch (tone()) {
            @case ('processing') {
              <span class="processing-spinner"></span>
            }
            @case ('success') {
              <svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
            }
            @case ('warning') {
              <svg viewBox="0 0 24 24"><path d="M12 7v6M12 16.5v.5" /></svg>
            }
            @default {
              <svg viewBox="0 0 24 24"><path d="M12 8v5M12 16.5v.5" /></svg>
            }
          }
        </div>
      } @else if (tone() === 'processing') {
        <span class="processing-spinner small" aria-hidden="true"></span>
      }
      <h2>{{ heading() }}</h2>
      @if (store.ready() && store.preview()) {
        <p class="pay-lead">Online payment is available for live bookings.</p>
      } @else if (store.ready() && !store.signedIn()) {
        <p class="pay-lead">Sign in to check your booking and payment.</p>
        <div class="pay-actions">
          <a class="button" routerLink="/sign-in" [queryParams]="{ next: '/bookings' }">Sign in</a>
        </div>
      } @else if (!activeId()) {
        <p class="pay-lead">Open the booking from My bookings to check its payment.</p>
        <div class="pay-actions">
          <a class="button" routerLink="/bookings">View my bookings</a>
        </div>
      } @else if (store.ready() && store.signedIn()) {
        @if (lead()) {
          <p class="pay-lead" [class.processing]="processing()">{{ lead() }}</p>
        }
        @if (message()) {
          <p class="pay-note" role="status">{{ message() }}</p>
        }
        @if (booking(); as order) {
          <dl class="pay-details">
            <div>
              <dt>Booking</dt>
              <dd>{{ order.booking_ref }}</dd>
            </div>
            <div>
              <dt>{{ status()?.payment_state === 'paid' ? 'Amount paid' : 'Amount' }}</dt>
              <dd>{{ money(order.total_paise) }}</dd>
            </div>
            @if (order.slot_starts_at) {
              <div>
                <dt>Collection</dt>
                <dd>{{ collectionTime(order) }}</dd>
              </div>
            }
            @if (order.lines?.length) {
              <div>
                <dt>Tests</dt>
                <dd>{{ testNames(order) }}</dd>
              </div>
            }
            @if (order.patients.length) {
              <div>
                <dt>For</dt>
                <dd>{{ patientNames(order) }}</dd>
              </div>
            }
          </dl>
        }
        <!-- Only when the server has no fallback email and asks for one (it sends a Forum address otherwise). -->
        @if (feedback() === 'email_required') {
          <label class="pay-email" for="payu-email-{{ activeId() }}"
              >Email
              <input
                id="payu-email-{{ activeId() }}"
                type="email"
                autocomplete="email"
                [ngModel]="email()"
                (ngModelChange)="email.set($event)"
                [required]="feedback() === 'email_required'"
                [disabled]="acting()"
            /></label>
        }
        <div class="pay-actions">
          @if (status()?.can_retry || feedback() === 'email_required') {
            <button
              class="button"
              type="button"
              [disabled]="acting() || (feedback() === 'email_required' && !email().trim())"
              (click)="retry()"
            >
              {{
                status()?.payment_state === 'awaiting_payment' ? 'Pay online' : 'Try payment again'
              }}
            </button>
          }
          @if (status()?.can_switch && !processing()) {
            <button
              class="button outline"
              type="button"
              [disabled]="acting()"
              (click)="switchToCollection()"
            >
              Pay at collection
            </button>
          }
          @if (rebook()) {
            <a class="button" routerLink="/tests">Book again</a>
          }
          @if (status()?.payment_state === 'paid' || status()?.payment_state === 'pay_at_collection') {
            @if (!embedded()) {
              <a class="button" routerLink="/bookings">View my bookings</a>
              <a class="button outline" routerLink="/tests">Book another test</a>
            }
          } @else {
            <button
              class="button outline"
              type="button"
              [disabled]="acting() || checkingNow()"
              (click)="refresh()"
            >
              {{ checkingNow() ? 'Checking…' : 'Check status' }}
            </button>
            @if (!embedded()) {
              <a class="text-link" routerLink="/bookings">My bookings</a>
            }
          }
        </div>
      }
    </section>
  `,
  styles: `
    :host {
      display: block;
    }
    .pay-card {
      max-width: 34rem;
      margin: 2.5rem auto;
      padding: 2.5rem 2rem;
      background: var(--white);
      border: 1px solid var(--border);
      border-radius: 16px;
      text-align: center;
    }
    .pay-card.embedded {
      margin: 0;
      padding: 1.25rem;
      text-align: left;
      max-width: none;
    }
    .pay-card h2 {
      font-size: 1.5rem;
      margin: 1rem 0 0.5rem;
    }
    .pay-card.embedded h2 {
      font-size: 1.1rem;
      margin-top: 0;
    }
    .pay-icon {
      width: 4.5rem;
      height: 4.5rem;
      margin: 0 auto;
      border-radius: 50%;
      display: grid;
      place-items: center;
      background: var(--blush);
    }
    .pay-icon svg {
      width: 2.25rem;
      height: 2.25rem;
      fill: none;
      stroke: var(--primary);
      stroke-width: 2.5;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .pay-icon.success {
      background: #e7f6ec;
    }
    .pay-icon.success svg {
      stroke: #1e7b45;
    }
    .pay-icon.warning {
      background: #fdf1e3;
    }
    .pay-icon.warning svg {
      stroke: #a15c07;
    }
    .pay-lead {
      color: var(--body);
      line-height: 1.6;
      margin: 0 auto 1.25rem;
      max-width: 28rem;
    }
    .pay-note {
      font-size: 0.9rem;
      color: var(--body);
    }
    .pay-details {
      margin: 1.5rem 0;
      padding: 1.25rem 1.25rem 0.25rem;
      background: var(--blush-light);
      border-radius: 16px;
      text-align: left;
    }
    .pay-details div {
      display: flex;
      justify-content: space-between;
      gap: 1rem;
      margin-bottom: 1rem;
    }
    .pay-details dt {
      color: var(--body);
      font-size: 0.85rem;
    }
    .pay-details dd {
      margin: 0;
      color: var(--ink);
      font-weight: 600;
      font-size: 0.9rem;
      text-align: right;
    }
    .pay-email {
      display: block;
      text-align: left;
      margin: 1rem 0;
    }
    .pay-actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      align-items: center;
      gap: 0.75rem;
      margin-top: 1.5rem;
    }
    .pay-card.embedded .pay-actions {
      justify-content: flex-start;
      margin-top: 1rem;
    }
    .processing-spinner {
      display: block;
      width: 2.25rem;
      height: 2.25rem;
      border: 3px solid var(--white);
      border-top-color: var(--primary);
      border-radius: 50%;
      animation: payment-spin 0.9s linear infinite;
    }
    .processing-spinner.small {
      width: 1.25rem;
      height: 1.25rem;
      border-color: var(--blush);
      border-top-color: var(--primary);
    }
    @media (prefers-reduced-motion: reduce) {
      .processing-spinner {
        animation-duration: 2.4s;
      }
    }
    @keyframes payment-spin {
      to {
        transform: rotate(360deg);
      }
    }
    @media (max-width: 760px) {
      .pay-card {
        margin: 1.25rem 16px;
        padding: 2rem 1.25rem;
      }
      .pay-card.embedded {
        margin: 0;
      }
      .pay-actions .button {
        width: 100%;
      }
    }
  `,
})
export class PaymentStatus {
  readonly orderId = input<string | null>(null);
  protected readonly store = inject(WebsiteStore);
  private readonly platform = inject(PLATFORM_ID);
  private readonly params = signal<string | null>(null);
  protected readonly activeId = computed(() => paymentOrderId(this.orderId() ?? this.params()));
  protected readonly status = signal<PaymentStatusView | null>(null);
  protected readonly feedback = signal<PayuLaunch | null>(null);
  protected readonly email = signal('');
  protected readonly message = signal('');
  protected readonly rebook = signal(false);
  protected readonly acting = signal(false);
  protected readonly instant = instant;
  protected readonly money = money;
  /** Inside a booking card (an order id input) the page stays compact: no icon, no details block. */
  protected readonly embedded = computed(() => !!this.orderId());
  protected readonly booking = signal<Order | null>(null);
  /** A manual "Check status" in flight; the answer may well be unchanged, so say when it was checked. */
  protected readonly checkingNow = signal(false);
  protected readonly tone = computed(() => {
    switch (this.status()?.payment_state) {
      case 'paid':
      case 'pay_at_collection':
        return 'success';
      case 'retryable':
      case 'expired':
        return 'warning';
      case 'awaiting_payment':
      case 'refund_in_progress':
      case 'refunded':
        return 'info';
      default:
        return 'processing';
    }
  });
  protected readonly lead = computed(() => {
    const status = this.status();
    switch (status?.payment_state) {
      case 'paid':
        return 'Thank you. Your home collection is booked and paid. We’ll keep you updated as your collection time approaches.';
      case 'pay_at_collection':
        return 'Your booking is confirmed. Pay by cash or UPI when we collect your sample.';
      case 'awaiting_payment':
        return status.expires_at
          ? `Your slot is held until ${instant(status.expires_at)}. Complete the payment to confirm your booking.`
          : 'Complete the payment to confirm your booking.';
      case 'retryable':
        return `Your payment didn’t go through. Try again${status.expires_at ? ` before ${instant(status.expires_at)}` : ''}, or pay at collection instead. If any amount was deducted, it will be refunded automatically.`;
      case 'expired':
        return 'The payment wasn’t completed in time, so the slot was released. If any amount was deducted, it will be refunded automatically.';
      case 'refund_in_progress':
      case 'refunded':
        return '';
      default:
        return 'We’re confirming your payment with PayU. This usually takes a few seconds. Please don’t pay again.';
    }
  });
  protected collectionTime(order: Order): string {
    const range = order.slot_ends_at
      ? slotTimeRange({ id: '', starts_at: order.slot_starts_at!, ends_at: order.slot_ends_at, capacity_left: 0, best_for_fasting: false })
      : '';
    const day = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short' })
      .format(Date.parse(order.slot_starts_at!));
    return range ? `${day}, ${range}` : instant(order.slot_starts_at);
  }
  protected testNames(order: Order): string {
    return (order.lines ?? []).map((line) => line.test_name).join(', ');
  }
  protected patientNames(order: Order): string {
    return order.patients.map((patient) => patient.first_name || 'Me').join(', ');
  }
  protected readonly isWaiting = computed(() => {
    const state = this.status()?.payment_state;
    return state === 'checking' || state === 'awaiting_payment' || state === 'retryable';
  });
  /** Before the first answer, and while the server checks PayU's reply. */
  protected readonly processing = computed(() => {
    const state = this.status()?.payment_state;
    return state === 'checking' || (!this.status() && !!this.activeId() && this.store.signedIn() && !this.store.preview());
  });
  protected readonly heading = computed(() => {
    switch (this.status()?.payment_state) {
      case 'awaiting_payment':
        return 'Complete your payment';
      case 'retryable':
        return 'Payment not completed';
      case 'paid':
        return 'Payment confirmed';
      case 'pay_at_collection':
        return 'Pay at collection';
      case 'expired':
        return 'The payment hold expired';
      case 'refund_in_progress':
        return 'Refund in progress';
      case 'refunded':
        return 'Refunded';
      default:
        return 'Processing your payment…';
    }
  });
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    inject(Meta).updateTag({ name: 'robots', content: 'noindex,nofollow' });
    const route = inject(ActivatedRoute);
    route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((query) => {
      const ids = query.getAll('order');
      this.params.set(ids.length === 1 ? ids[0] : null);
    });
    inject(DestroyRef).onDestroy(() => this.stop());
    effect(() => {
      const id = this.activeId();
      const owner = this.store.profile()?.id;
      const ready = this.store.ready() && this.store.signedIn() && !this.store.preview();
      untracked(() => {
        this.stop();
        this.status.set(null);
        this.booking.set(null);
        this.checkingNow.set(false);
        this.email.set('');
        this.message.set('');
        this.rebook.set(false);
        this.acting.set(false);
        this.feedback.set(null);
        if (!isPlatformBrowser(this.platform) || !ready || !owner || !id) return;
        const feedback = this.store.initialPayuFeedback();
        if (feedback?.orderId === id) this.showFeedback(feedback.kind);
        void this.read(id, owner, this.generation, 1);
      });
    });
  }

  private stop(): void {
    this.generation++;
    clearTimeout(this.timer);
  }

  private current(id: string, owner: string, generation: number): boolean {
    return (
      generation === this.generation &&
      id === this.activeId() &&
      this.store.signedIn() &&
      this.store.profile()?.id === owner
    );
  }

  private async read(id: string, owner: string, generation: number, count: number): Promise<void> {
    try {
      const status = await this.store.paymentStatus(id);
      if (!this.current(id, owner, generation)) return;
      this.status.set(status);
      if (!this.embedded() && !this.booking()) {
        void this.store.paymentBooking(id).then(
          (order) => {
            if (order && this.current(id, owner, generation)) this.booking.set(order);
          },
          () => undefined,
        );
      }
      if (!this.isWaiting()) {
        this.feedback.set(null);
        const expired = status.payment_state === 'expired';
        this.rebook.set(expired);
        this.message.set(expired ? 'Book again to select a new collection slot.' : '');
        if (status.payment_state === 'refund_in_progress' || status.payment_state === 'refunded') {
          const order = await this.store.paymentRefund(id).catch(() => null);
          if (!order || !this.current(id, owner, generation)) return;
          const rebook = order.status === 'cancelled' && order.payment_status === 'payment_pending';
          this.rebook.set(rebook);
          const text =
            status.payment_state === 'refund_in_progress' && order.refund?.state === 'pending'
              ? refundProgressText(order.refund)
              : '';
          this.message.set(
            [text, rebook ? 'Book again to select a new collection slot.' : '']
              .filter(Boolean)
              .join(' '),
          );
        }
      } else if (count < (status.payment_state === 'checking' ? MAX_PROCESSING_CHECKS : MAX_CHECKS)) {
        this.timer = setTimeout(() => void this.read(id, owner, generation, count + 1), POLL_MS);
      }
    } catch {
      if (this.current(id, owner, generation))
        this.message.set('Payment status could not be checked. Please try again.');
    }
  }

  protected async refresh(): Promise<void> {
    const id = this.activeId(),
      owner = this.store.profile()?.id;
    if (
      !isPlatformBrowser(this.platform) ||
      !id ||
      !owner ||
      !this.store.signedIn() ||
      this.store.preview()
    )
      return;
    this.stop();
    this.message.set('');
    const before = this.status()?.payment_state;
    const generation = this.generation;
    this.checkingNow.set(true);
    try {
      await this.read(id, owner, generation, MAX_CHECKS);
    } finally {
      if (generation === this.generation) this.checkingNow.set(false);
    }
    if (!this.current(id, owner, generation) || this.message()) return;
    if (this.status()?.payment_state === before) {
      const time = new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      }).format(Date.now());
      this.message.set(`Checked at ${time} IST. No change yet.`);
    }
  }

  private showFeedback(kind: PayuLaunch): void {
    this.feedback.set(kind);
    if (kind === 'email_required') this.message.set('Enter your email to continue online payment.');
    if (kind === 'failed')
      this.message.set('Payment didn’t go through. Try again, or pay at collection instead.');
    if (kind === 'unavailable') this.message.set('Online payment is currently unavailable.');
    if (kind === 'checking' || kind === 'not_due')
      this.message.set('Checking your payment. Please wait for the booking status.');
  }

  protected async switchToCollection(): Promise<void> {
    const id = this.activeId(),
      owner = this.store.profile()?.id;
    if (
      !isPlatformBrowser(this.platform) ||
      !id ||
      !owner ||
      !this.status()?.can_switch ||
      this.acting()
    )
      return;
    this.stop();
    const generation = this.generation;
    this.acting.set(true);
    try {
      const result = await this.store.switchPayu(id);
      if (!this.current(id, owner, generation)) return;
      this.showFeedback(result === 'payu_unavailable' ? 'unavailable' : 'checking');
      await this.read(id, owner, generation, 1);
    } catch {
      if (this.current(id, owner, generation))
        this.message.set('Payment choice could not be changed. Check your booking status.');
    } finally {
      if (this.current(id, owner, generation)) this.acting.set(false);
    }
  }

  protected async retry(skip = false): Promise<void> {
    const id = this.activeId(),
      owner = this.store.profile()?.id;
    if (
      !isPlatformBrowser(this.platform) ||
      !id ||
      !owner ||
      this.acting() ||
      (!this.status()?.can_retry && this.feedback() !== 'email_required')
    )
      return;
    this.stop();
    const generation = this.generation;
    this.acting.set(true);
    try {
      const result = await this.store.startPayu(id, skip ? '' : this.email());
      if (!this.current(id, owner, generation)) return;
      this.showFeedback(result);
      if (result !== 'redirected') await this.read(id, owner, generation, 1);
    } catch {
      if (this.current(id, owner, generation))
        this.message.set('Check your booking status before trying again.');
    } finally {
      if (this.current(id, owner, generation)) this.acting.set(false);
    }
  }
}
