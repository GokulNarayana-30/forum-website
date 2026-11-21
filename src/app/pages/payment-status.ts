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
  paymentOrderId,
  PaymentStatusView,
  PayuLaunch,
  refundProgressText,
} from '../core/models';
import { WebsiteStore } from '../core/store';

const MAX_CHECKS = 8;
const POLL_MS = 3000;

@Component({
  selector: 'forum-payment-status',
  imports: [RouterLink, FormsModule],
  template: `
    <section class="panel" aria-label="Payment status">
      <h2>{{ heading() }}</h2>
      @if (store.ready() && store.preview()) {
        <p>Online payment is available for live bookings.</p>
      } @else if (store.ready() && !store.signedIn()) {
        <p>Sign in to check your booking and payment.</p>
        <a class="button" routerLink="/sign-in" [queryParams]="{ next: '/bookings' }">Sign in</a>
      } @else if (!activeId()) {
        <p>Open the booking from My bookings to check its payment.</p>
      } @else if (store.ready() && store.signedIn()) {
        @if (status()?.expires_at && isWaiting()) {
          <p>Pay by {{ instant(status()?.expires_at ?? undefined) }} to keep this slot.</p>
        }
        @if (message()) {
          <p role="status">{{ message() }}</p>
        }
        @if (status()?.can_retry || feedback() === 'email_required') {
          @if (!store.profile()?.email || feedback() === 'email_required') {
            <label for="payu-email-{{ activeId() }}">{{
              feedback() === 'email_required' ? 'Email' : 'Email (optional)'
            }}</label>
            <input
              id="payu-email-{{ activeId() }}"
              type="email"
              autocomplete="email"
              [ngModel]="email()"
              (ngModelChange)="email.set($event)"
              [required]="feedback() === 'email_required'"
              [disabled]="acting()"
            />
          }
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
          @if (!store.profile()?.email && feedback() !== 'email_required') {
            <button
              class="button outline"
              type="button"
              [disabled]="acting()"
              (click)="retry(true)"
            >
              Skip
            </button>
          }
        }
        @if (status()?.can_switch) {
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
          <a class="button outline" routerLink="/tests">Book again</a>
        }
        <button class="button outline" type="button" [disabled]="acting()" (click)="refresh()">
          Check status
        </button>
      }
      @if (!orderId()) {
        <a class="text-link" routerLink="/bookings">My bookings</a>
      }
    </section>
  `,
  styles: `
    :host {
      display: block;
    }
    section {
      max-width: 42rem;
      margin: 1rem auto;
    }
    label,
    input {
      display: block;
      margin-block: 0.5rem;
    }
    button,
    a {
      margin: 0.5rem 0.5rem 0.5rem 0;
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
  protected readonly isWaiting = computed(() => {
    const state = this.status()?.payment_state;
    return state === 'checking' || state === 'awaiting_payment' || state === 'retryable';
  });
  protected readonly heading = computed(() => {
    switch (this.status()?.payment_state) {
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
        return 'Checking your payment…';
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
      } else if (count < MAX_CHECKS) {
        this.timer = setTimeout(() => void this.read(id, owner, generation, count + 1), POLL_MS);
      }
    } catch {
      if (this.current(id, owner, generation))
        this.message.set('Payment status could not be checked. Please try again.');
    }
  }

  protected refresh(): void {
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
    void this.read(id, owner, this.generation, MAX_CHECKS);
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
