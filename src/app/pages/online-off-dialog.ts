import { Component, input, output } from '@angular/core';

/**
 * Online payment is down (owner, 2026-11-23): Confirm asks before booking, so the customer
 * chooses pay at collection instead of the website deciding for them. "Not now" books nothing.
 */
@Component({
  selector: 'forum-online-off-dialog',
  template: `
    @if (open()) {
      <div class="online-off-backdrop">
        <div
          class="online-off-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="online-off-title"
        >
          <span class="online-off-icon" aria-hidden="true">!</span>
          <h2 id="online-off-title">Online payment is unavailable</h2>
          <p>
            Our online payment service is temporarily down. You can still book now and pay the
            phlebotomist at collection, by cash or UPI.
          </p>
          <button class="button" type="button" (click)="book.emit()">
            Book and pay at collection
          </button>
          <button class="button outline" type="button" (click)="dismissed.emit()">Not now</button>
        </div>
      </div>
    }
  `,
  styles: `
    .online-off-backdrop {
      position: fixed;
      inset: 0;
      z-index: 1000;
      display: grid;
      place-items: center;
      padding: 16px;
      background: rgb(17 24 39 / 45%);
    }
    .online-off-dialog {
      width: min(100%, 26rem);
      background: var(--white);
      border-radius: 16px;
      padding: 2rem 1.5rem 1.5rem;
      text-align: center;
      box-shadow: 0 20px 40px rgb(17 24 39 / 20%);
    }
    .online-off-icon {
      display: grid;
      place-items: center;
      width: 3.5rem;
      height: 3.5rem;
      margin: 0 auto 0.75rem;
      border-radius: 50%;
      background: var(--blush);
      color: var(--primary);
      font-weight: 700;
      font-size: 1.5rem;
    }
    h2 {
      font-size: 1.25rem;
      margin: 0 0 0.5rem;
    }
    p {
      color: var(--body);
      line-height: 1.6;
      margin: 0.5rem 0;
    }
    .button {
      margin-top: 0.75rem;
      width: 100%;
    }
  `,
})
export class OnlineOffDialog {
  readonly open = input(false);
  readonly book = output<void>();
  readonly dismissed = output<void>();
}
