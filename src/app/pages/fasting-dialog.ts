import { Component, input, output } from '@angular/core';

/**
 * The fasting note as a popup (owner, 2026-11-22): shown only when a test in the booking needs
 * fasting, instead of a preparation section on every booking. OK records that it was read.
 * It repeats the lab's own instructions and never gives medical advice of its own.
 */
@Component({
  selector: 'forum-fasting-dialog',
  template: `
    @if (open()) {
      <div class="fasting-backdrop">
        <div class="fasting-dialog" role="dialog" aria-modal="true" aria-labelledby="fasting-title">
          <span class="fasting-icon" aria-hidden="true">!</span>
          <h2 id="fasting-title">Fasting required</h2>
          <p class="fasting-hours">{{ hoursText() }}</p>
          @for (line of instructions(); track line) {
            <p>{{ line }}</p>
          }
          <p class="fasting-hint">Early morning times are best for fasting tests.</p>
          <p class="fasting-hint">
            Do not change prescribed medicines without your clinician’s advice.
          </p>
          <button class="button" type="button" (click)="acknowledged.emit()">OK, got it</button>
        </div>
      </div>
    }
  `,
  styles: `
    .fasting-backdrop {
      position: fixed;
      inset: 0;
      z-index: 1000;
      display: grid;
      place-items: center;
      padding: 16px;
      background: rgb(17 24 39 / 45%);
    }
    .fasting-dialog {
      width: min(100%, 26rem);
      background: var(--white);
      border-radius: 16px;
      padding: 2rem 1.5rem 1.5rem;
      text-align: center;
      box-shadow: 0 20px 40px rgb(17 24 39 / 20%);
    }
    .fasting-icon {
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
    .fasting-hours {
      color: var(--ink);
      font-weight: 600;
    }
    p {
      color: var(--body);
      line-height: 1.6;
      margin: 0.5rem 0;
    }
    .fasting-hint {
      font-size: 0.85rem;
    }
    .button {
      margin-top: 1rem;
      width: 100%;
    }
  `,
})
export class FastingDialog {
  readonly open = input(false);
  readonly minHours = input<number | null | undefined>(null);
  readonly maxHours = input<number | null | undefined>(null);
  readonly instructions = input<string[]>([]);
  readonly acknowledged = output<void>();

  protected hoursText(): string {
    const min = this.minHours();
    const max = this.maxHours();
    if (min && max && max > min) return `Fast for ${min}–${max} hours before your collection.`;
    if (min || max) return `Fast for at least ${min || max} hours before your collection.`;
    return 'Please fast before your collection, as the lab instructs.';
  }
}
