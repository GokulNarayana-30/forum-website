import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { WebsiteStore } from '../core/store';
import { instant, money } from '../core/models';
@Component({
  selector: 'forum-summary',
  imports: [RouterLink],
  template: `<aside class="summary">
    <div class="summary-heading">
      <p class="eyebrow">YOUR COLLECTION</p>
      <h2>Order summary</h2>
    </div>
    <button
      class="summary-toggle"
      type="button"
      aria-controls="order-summary-content"
      [attr.aria-expanded]="expanded()"
      (click)="expanded.set(!expanded())"
    >
      <span
        >Order summary<small>{{
          store.preview()
            ? 'Sample subtotal'
            : store.quote()
              ? 'Pay at collection'
              : 'Estimated subtotal'
        }}</small></span
      ><strong>{{ money(store.total()) }}</strong
      ><span aria-hidden="true">{{ expanded() ? '−' : '+' }}</span>
    </button>
    <div id="order-summary-content" class="summary-body" [class.is-collapsed]="!expanded()">
      <div class="summary-lines">
        @for (line of store.lines(); track line.id) {
          <p>
            <span>{{ line.item_name }}</span
            ><strong>{{ money(line.price_paise) }}</strong>
          </p>
        }
      </div>
      @if (store.quote(); as quote) {
        <p>
          <span>Tests & packages</span><span>{{ money(quote.item_total_paise) }}</span>
        </p>
        <p>
          <span>Coupon discount</span><span>− {{ money(quote.discount_paise) }}</span>
        </p>
        <p>
          <span>Collection fee</span><span>{{ money(quote.collection_fee_paise) }}</span>
        </p>
        <p>
          <span>Taxes</span><span>{{ money(quote.taxes_paise) }}</span>
        </p>
        <div class="summary-total">
          <span>Pay at collection</span><strong>{{ money(quote.to_pay_paise) }}</strong>
        </div>
      } @else {
        <div class="summary-total">
          <span>{{ store.preview() ? 'Sample subtotal' : 'Estimated subtotal' }}</span
          ><strong>{{ money(store.total()) }}</strong>
        </div>
        <p class="hint">
          {{
            store.preview()
              ? 'Sample prices for preview only.'
              : 'Final price, collection fee and any taxes are confirmed by the server before booking.'
          }}
        </p>
      }
      @if (store.address(); as address) {
        <div class="summary-note">
          <strong>{{ address.type }}</strong>
          <p>{{ address.house }}, {{ address.area }} · {{ address.pincode }}</p>
        </div>
      }
      @if (store.slot(); as slot) {
        <div class="summary-note">
          <strong>Collection time</strong>
          <p>{{ instant(slot.starts_at) }}</p>
        </div>
      }
      <div class="summary-note">
        <strong>Cash or UPI at collection</strong>
        <p>No online payment is needed.</p>
      </div>
      <a class="text-link" routerLink="/tests">Continue browsing →</a>
    </div>
  </aside>`,
})
export class Summary {
  protected readonly expanded = signal(false);
  protected readonly store = inject(WebsiteStore);
  protected readonly money = money;
  protected readonly instant = instant;
}
