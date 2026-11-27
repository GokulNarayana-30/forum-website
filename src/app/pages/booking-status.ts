import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { WebsiteApi, WebsiteError } from '../core/api';
import { WebsiteClock } from '../core/clock';
import { PaymentStatus } from './payment-status';
import {
  CUSTOMER_CANCEL_REASONS,
  Order,
  cancelReasonLabel,
  instant,
  money,
  refundProgressText,
} from '../core/models';

interface Tracking {
  order_id: string;
  events: { kind: string; at: string; reason_code?: string | null }[];
  refund?: Order['refund'];
  refund_timeline?: string | null;
}

@Component({
  selector: 'forum-booking-status',
  imports: [FormsModule, RouterLink, PaymentStatus],
  template: `<section class="panel" aria-label="Booking status" [attr.aria-busy]="loading()">
    <h2 #heading tabindex="-1">{{ order().booking_ref }} · Status</h2>
    @if (onlinePending()) {
      <forum-payment-status [orderId]="order().id" />
    } @else {
      <p>
        <strong>{{ label(order().status) }}</strong>
      </p>
      @if (order().payment_method_label) {
        <p>{{ order().payment_method_label }}</p>
      }
      @if (cancelReasonText()) {
        <p class="hint">Cancellation reason: {{ cancelReasonText() }}</p>
      }
      @if (refundMessage(); as refund) {
        <p>{{ refund }}</p>
      }
    }
    <p>Collection: {{ instant(order().slot_starts_at) }}</p>
    @if (order().address; as addr) {
      <p class="hint">
        Address: {{ addr.house }}@if (addr.street) {, {{ addr.street }}}, {{ addr.area }} ·
        {{ addr.pincode }}
      </p>
    }
    @if (order().patients.length) {
      <p class="hint">Patients: {{ patientNames() }}</p>
    }
    @if (order().lines?.length) {
      <ul class="order-lines" aria-label="Booked tests">
        @for (line of order().lines ?? []; track $index) {
          <li>{{ line.test_name }} · {{ money(line.amount_paise) }}</li>
        }
      </ul>
    }
    @if (loading()) {
      <p role="status">Loading booking updates…</p>
    } @else if (error()) {
      <p role="alert">{{ error() }}</p>
      <button class="button outline" type="button" (click)="load(order().id)">Retry status</button>
    } @else if (tracking()?.events?.length) {
      <ol aria-label="Booking updates">
        @for (event of tracking()?.events ?? []; track $index) {
          <li>
            <strong>{{ label(event.kind) }}</strong>
            @if (event.reason_code) {
              <span> · {{ reasonText(event.reason_code) }}</span>
            }
            <br /><time [attr.datetime]="event.at">{{ instant(event.at) }}</time>
          </li>
        }
      </ol>
    } @else {
      <p>No tracking updates yet. Your current booking status is shown above.</p>
    }

    @if (actionError()) {
      <p class="inline-error" role="alert">{{ actionError() }}</p>
    }
    @if (actionMessage()) {
      <p class="notice-box" role="status">{{ actionMessage() }}</p>
    }
    @if (receiptLink(); as rlink) {
      <div class="notice-box">
        <p>Your receipt link is ready.</p>
        <a
          class="button outline"
          [href]="rlink.url"
          target="_blank"
          rel="noopener noreferrer"
          (click)="checkReceiptLink($event)"
        >
          Download receipt PDF ↗
        </a>
      </div>
    }

    <div class="booking-status-actions">
      @if (canDownloadReceipt()) {
        <button
          class="button outline"
          type="button"
          [disabled]="acting()"
          (click)="loadReceipt()"
        >
          {{ acting() ? 'Loading…' : 'Get receipt' }}
        </button>
      }
      @if (canCancelOrder()) {
        @if (confirmingCancel()) {
          <div class="cancel-panel">
            <label>
              <span>Why are you cancelling?</span>
              <select [ngModel]="cancelReason()" (ngModelChange)="cancelReason.set($event)">
                <option value="">Select a reason</option>
                @for (r of cancelReasons; track r.code) {
                  <option [value]="r.code">{{ r.label }}</option>
                }
              </select>
            </label>
            <div class="cancel-buttons">
              <button
                class="button"
                type="button"
                [disabled]="!cancelReason() || acting()"
                (click)="submitCancel()"
              >
                {{ acting() ? 'Cancelling…' : 'Confirm cancellation' }}
              </button>
              <button
                class="button outline"
                type="button"
                [disabled]="acting()"
                (click)="confirmingCancel.set(false); actionError.set('')"
              >
                Keep booking
              </button>
            </div>
          </div>
        } @else {
          <button
            class="button outline"
            type="button"
            [disabled]="acting()"
            (click)="confirmingCancel.set(true); actionError.set('')"
          >
            Cancel booking
          </button>
        }
      }
    </div>

    <a class="text-link" routerLink="/help">Need help with this collection? →</a>
  </section>`,
  styles: `
    :host {
      display: block;
    }
    section {
      border-color: var(--primary);
    }
    h2 {
      font-size: 20px;
      overflow-wrap: anywhere;
      margin: 0 0 18px;
      scroll-margin-top: calc(var(--website-header-height) + 20px);
    }
    p {
      margin-block: 14px;
    }
    ol {
      padding-left: 22px;
      margin-block: 24px;
    }
    li {
      padding: 0 0 18px 8px;
    }
    time {
      display: inline-block;
      font-size: 12px;
      color: var(--body);
      margin-top: 6px;
    }
    .text-link {
      display: inline-block;
      margin-top: 18px;
    }
    .order-lines {
      padding-left: 18px;
      margin: 8px 0 14px;
      font-size: 0.9rem;
      color: var(--body);
    }
    .booking-status-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      margin-top: 16px;
    }
    .cancel-panel {
      width: 100%;
      padding: 14px;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--blush-light);
      display: grid;
      gap: 10px;
    }
    .cancel-buttons {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
  `,
})
export class BookingStatus {
  readonly order = input.required<Order>();
  readonly cancelled = output<void>();
  private readonly api = inject(WebsiteApi);
  private readonly clock = inject(WebsiteClock);
  private readonly heading = viewChild<ElementRef<HTMLHeadingElement>>('heading');
  protected readonly tracking = signal<Tracking | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly acting = signal(false);
  protected readonly actionError = signal('');
  protected readonly actionMessage = signal('');
  protected readonly confirmingCancel = signal(false);
  protected readonly cancelReason = signal('');
  protected readonly receiptLink = signal<{ url: string; expiresAt: number } | null>(null);
  protected readonly cancelReasons = CUSTOMER_CANCEL_REASONS;
  protected readonly reasonText = cancelReasonLabel;
  protected readonly instant = instant;
  protected readonly money = money;
  protected readonly onlinePending = computed(
    () => this.order().payment_status === 'payment_pending',
  );
  protected readonly cancelReasonText = computed(() => {
    const code =
      this.order().cancel_reason_code ??
      this.tracking()?.events.find((e) => e.kind === 'cancelled' && e.reason_code)?.reason_code;
    return cancelReasonLabel(code);
  });
  protected readonly canCancelOrder = computed(() => {
    const o = this.order();
    if (o.can_cancel === false) return false;
    return [
      'payment_pending',
      'confirmed',
      'phlebotomist_assigned',
      'on_the_way',
      'arrived',
      'collection_failed',
    ].includes(o.status);
  });
  protected readonly canDownloadReceipt = computed(() => {
    const o = this.order();
    return (
      o.payment_status === 'paid' ||
      ['collected', 'received_by_lab', 'processing', 'report_ready', 'refunded'].includes(o.status)
    );
  });
  protected readonly refundMessage = computed(
    () =>
      this.tracking()?.refund_timeline ||
      refundProgressText(this.tracking()?.refund ?? this.order().refund),
  );
  private sequence = 0;

  protected patientNames(): string {
    return this.order().patients.map((p) => p.first_name || 'Me').join(', ');
  }

  protected async submitCancel(): Promise<void> {
    const reason = this.cancelReason();
    if (!reason || this.acting()) return;
    this.acting.set(true);
    this.actionError.set('');
    this.actionMessage.set('');
    try {
      const orderId = this.order().id;
      const key = 'can_' + crypto.randomUUID().replaceAll('-', '');
      const res = await this.api.request<{ kind?: string }>(
        '/orders/' + encodeURIComponent(orderId) + '/cancellation',
        'POST',
        { reason_code: reason },
        key,
      );
      if (res?.kind && res.kind.includes('not_allowed')) {
        this.actionError.set('This booking can no longer be cancelled online. Contact support.');
        return;
      }
      this.confirmingCancel.set(false);
      this.cancelReason.set('');
      this.actionMessage.set('Your booking has been cancelled.');
      await this.load(orderId);
      this.cancelled.emit();
    } catch (err) {
      this.actionError.set(
        err instanceof WebsiteError ? err.message : 'Could not cancel booking. Please try again.',
      );
    } finally {
      this.acting.set(false);
    }
  }

  protected async loadReceipt(): Promise<void> {
    if (this.acting()) return;
    this.acting.set(true);
    this.actionError.set('');
    try {
      const link = await this.api.request<{ source: string; expires_at: string }>(
        '/orders/' + encodeURIComponent(this.order().id) + '/invoice/document-links',
        'POST',
      );
      const u = new URL(link.source);
      if (u.protocol !== 'https:' || !(Date.parse(link.expires_at) > this.clock.now())) {
        throw new WebsiteError('link', 'The receipt link has expired. Please try again.');
      }
      this.receiptLink.set({ url: u.toString(), expiresAt: Date.parse(link.expires_at) });
    } catch (err) {
      this.actionError.set(
        err instanceof WebsiteError
          ? err.message
          : 'Receipt is unavailable right now. Please try again later.',
      );
    } finally {
      this.acting.set(false);
    }
  }

  protected checkReceiptLink(event: Event): void {
    const link = this.receiptLink();
    if (!link || link.expiresAt <= this.clock.now()) {
      event.preventDefault();
      this.receiptLink.set(null);
      this.actionError.set('Your receipt link has expired. Request a new one.');
    }
  }

  constructor() {
    inject(DestroyRef).onDestroy(() => this.sequence++);
    effect(() => {
      const order = this.order();
      untracked(() => void this.load(order.id));
    });
    afterNextRender(() => {
      const heading = this.heading()?.nativeElement;
      heading?.focus({ preventScroll: true });
      heading?.scrollIntoView?.({ block: 'start' });
    });
  }

  protected label(value: string): string {
    const text = value.replaceAll('_', ' ');
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  protected async load(orderId: string): Promise<void> {
    const sequence = ++this.sequence;
    this.loading.set(true);
    this.error.set('');
    this.tracking.set(null);
    try {
      const result = await this.api.request<Tracking>(
        '/orders/' + encodeURIComponent(orderId) + '/tracking',
      );
      if (
        result?.order_id !== orderId ||
        !Array.isArray(result.events) ||
        !result.events.every(
          (event) =>
            event &&
            typeof event.kind === 'string' &&
            typeof event.at === 'string' &&
            Number.isFinite(Date.parse(event.at)),
        )
      )
        throw new WebsiteError('response', 'Booking updates could not be read. Please retry.');
      if (sequence === this.sequence) this.tracking.set(result);
    } catch (error) {
      if (sequence === this.sequence)
        this.error.set(
          error instanceof WebsiteError
            ? error.message
            : 'Booking updates could not be loaded. Please retry.',
        );
    } finally {
      if (sequence === this.sequence) this.loading.set(false);
    }
  }
}
