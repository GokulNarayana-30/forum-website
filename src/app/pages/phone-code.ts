import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { WebsiteStore } from '../core/store';

/** A 10-digit Indian mobile (6-9 first), as typed; spaces and a leading +91 or 0 are ignored. */
export function indianMobile(typed: string): string | null {
  let digits = typed.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : null;
}

/**
 * The +91 number, then the 6-digit code texted to it (2026-11-15). [mode] 'sign-in' signs the visitor
 * in with the code; 'verify' confirms the number on the signed-in account (for example a Google
 * account) and saves it. Emits [done] after a right code.
 */
@Component({
  selector: 'app-phone-code',
  imports: [FormsModule],
  template: `
    @if (step() === 'phone') {
      <label
        >Mobile number<input
          name="phone-code-number"
          type="tel"
          inputmode="tel"
          autocomplete="tel"
          placeholder="+91 98765 43210"
          [ngModel]="number()"
          (ngModelChange)="typed.set($event)"
      /></label>
      @if (number() && !phone()) {
        <small class="field-error">Enter a 10-digit Indian mobile number.</small>
      }
      <button
        class="button full"
        type="button"
        [disabled]="store.busy() || !phone()"
        (click)="send()"
      >
        {{ mode() === 'sign-in' ? 'Get OTP' : 'Send code' }} →
      </button>
    } @else {
      <p>
        We texted a 6-digit code to <strong>{{ phone() }}</strong
        >.
        <button class="text-link" type="button" (click)="back()">Change number</button>
      </p>
      <label
        >Code<input
          name="phone-code-otp"
          type="text"
          inputmode="numeric"
          autocomplete="one-time-code"
          maxlength="6"
          [ngModel]="code()"
          (ngModelChange)="code.set($event)"
      /></label>
      <button
        class="button full"
        type="button"
        [disabled]="store.busy() || code().length !== 6"
        (click)="check()"
      >
        {{ mode() === 'sign-in' ? 'Sign in' : 'Verify' }} →
      </button>
      <button class="text-link" type="button" [disabled]="store.busy()" (click)="send()">
        Send the code again
      </button>
    }
  `,
})
export class PhoneCode {
  protected readonly store = inject(WebsiteStore);
  readonly mode = input<'sign-in' | 'verify'>('sign-in');
  readonly initialNumber = input<string | undefined>(undefined);
  readonly done = output<void>();
  protected readonly step = signal<'phone' | 'code'>('phone');
  protected readonly typed = signal<string | null>(null);
  protected readonly number = computed(() => this.typed() ?? this.initialNumber() ?? '');
  protected readonly phone = computed(() => indianMobile(this.number()));
  protected readonly code = signal('');

  protected async send(): Promise<void> {
    const phone = this.phone();
    if (!phone) return;
    this.typed.set(this.number());
    const ok =
      this.mode() === 'sign-in'
        ? await this.store.sendSignInCode(phone)
        : await this.store.sendMobileCode(phone);
    if (ok) {
      this.code.set('');
      this.step.set('code');
    }
  }

  protected async check(): Promise<void> {
    const phone = this.phone();
    const code = this.code().replace(/\D/g, '');
    if (!phone || code.length !== 6) return;
    const ok =
      this.mode() === 'sign-in'
        ? await this.store.verifySignInCode(phone, code)
        : await this.store.confirmMobileCode(phone, code);
    if (ok) this.done.emit();
  }

  protected back(): void {
    this.step.set('phone');
    this.code.set('');
  }
}
