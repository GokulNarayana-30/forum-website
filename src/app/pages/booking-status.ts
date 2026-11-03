import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { WebsiteApi, WebsiteError } from '../core/api';
import { Order, instant } from '../core/models';

interface Tracking {
  order_id: string;
  events: { kind: string; at: string }[];
}

@Component({
  selector: 'forum-booking-status',
  imports: [RouterLink],
  template: `<section class="panel" aria-label="Booking status" [attr.aria-busy]="loading()">
    <h2 #heading tabindex="-1">{{ order().booking_ref }} · Status</h2>
    <p>
      <strong>{{ label(order().status) }}</strong>
    </p>
    <p>Collection: {{ instant(order().slot_starts_at) }}</p>
    @if (loading()) {
      <p role="status">Loading booking updates…</p>
    } @else if (error()) {
      <p role="alert">{{ error() }}</p>
      <button class="button outline" type="button" (click)="load(order().id)">Retry status</button>
    } @else if (tracking()?.events?.length) {
      <ol aria-label="Booking updates">
        @for (event of tracking()?.events ?? []; track $index) {
          <li>
            <strong>{{ label(event.kind) }}</strong
            ><br /><time [attr.datetime]="event.at">{{ instant(event.at) }}</time>
          </li>
        }
      </ol>
    } @else {
      <p>No tracking updates yet. Your current booking status is shown above.</p>
    }
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
  `,
})
export class BookingStatus {
  readonly order = input.required<Order>();
  private readonly api = inject(WebsiteApi);
  private readonly heading = viewChild<ElementRef<HTMLHeadingElement>>('heading');
  protected readonly tracking = signal<Tracking | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly instant = instant;
  private sequence = 0;

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
