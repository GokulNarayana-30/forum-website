import { Component, OnDestroy, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { WebsiteStore } from '../core/store';

/** A 10-digit Indian mobile (6-9 first), as typed; spaces and a leading +91 or 0 are ignored. */
export function indianMobile(typed: string): string | null {
  let digits = typed.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : null;
}

/** +919876543210 as "+91 98765 43210". */
export function displayMobile(e164: string): string {
  const d = e164.replace(/^\+91/, '');
  return d.length === 10 ? `+91 ${d.slice(0, 5)} ${d.slice(5)}` : e164;
}

const RESEND_SECONDS = 30;

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
      <label class="pc-label" for="pc-number-{{ mode() }}">Mobile number</label>
      <div class="pc-number" [class.pc-invalid]="showNumberError()">
        <span class="pc-prefix" aria-hidden="true">+91</span>
        <input
          id="pc-number-{{ mode() }}"
          name="phone-code-number"
          type="tel"
          inputmode="numeric"
          autocomplete="tel-national"
          maxlength="14"
          placeholder="98765 43210"
          aria-describedby="pc-number-hint-{{ mode() }}"
          [ngModel]="number()"
          (ngModelChange)="typed.set($event)"
          (keydown.enter)="send()"
        />
      </div>
      <p class="pc-hint" id="pc-number-hint-{{ mode() }}" [class.pc-error]="showNumberError()">
        {{
          showNumberError()
            ? 'Enter your 10-digit mobile number.'
            : 'We’ll text you a 6-digit code. Standard SMS rates may apply.'
        }}
      </p>
      <button
        class="button full pc-action"
        type="button"
        [disabled]="store.busy() || !phone() || !canSend()"
        (click)="send()"
      >
        {{ store.busy() ? 'Sending…' : 'Get OTP' }}
      </button>
    } @else {
      <p class="pc-sent">
        Enter the 6-digit code sent to <strong>{{ shownPhone() }}</strong>
        <button class="pc-link" type="button" [disabled]="store.busy()" (click)="back()">
          Change
        </button>
      </p>
      <label class="pc-label sr-only" for="pc-code-{{ mode() }}">One-time code</label>
      <input
        class="pc-code"
        id="pc-code-{{ mode() }}"
        name="phone-code-otp"
        type="text"
        inputmode="numeric"
        autocomplete="one-time-code"
        maxlength="6"
        placeholder="••••••"
        [ngModel]="code()"
        (ngModelChange)="onCode($event)"
        (keydown.enter)="check()"
      />
      <button
        class="button full pc-action"
        type="button"
        [disabled]="store.busy() || code().length !== 6"
        (click)="check()"
      >
        {{
          store.busy() ? 'Checking…' : mode() === 'sign-in' ? 'Verify and sign in' : 'Verify number'
        }}
      </button>
      <p class="pc-resend">
        @if (secondsLeft() > 0) {
          Didn’t get it? Resend in {{ secondsLeft() }}s
        } @else {
          Didn’t get it?
          <button class="pc-link" type="button" [disabled]="store.busy()" (click)="send()">
            Resend code
          </button>
        }
      </p>
    }
    @if (store.error()) {
      <p class="pc-alert" role="alert">{{ store.error() }}</p>
    }
  `,
  styles: `
    :host {
      display: block;
      text-align: left;
    }
    .pc-label {
      display: block;
      font-weight: 600;
      font-size: 14px;
      color: var(--ink);
      margin-bottom: 8px;
    }
    .pc-number {
      display: flex;
      align-items: stretch;
      border: 1px solid var(--outline);
      border-radius: 12px;
      background: var(--white);
      overflow: hidden;
      transition:
        border-color 0.15s,
        box-shadow 0.15s;
    }
    .pc-number:focus-within {
      border-color: var(--primary);
      box-shadow: 0 0 0 3px rgba(113, 78, 160, 0.18);
    }
    .pc-number.pc-invalid {
      border-color: #b42318;
    }
    .pc-prefix {
      display: flex;
      align-items: center;
      padding: 0 14px;
      background: var(--blush-light);
      color: var(--ink);
      font-weight: 600;
      border-right: 1px solid var(--border);
    }
    .pc-number input {
      flex: 1;
      min-width: 0;
      border: 0;
      outline: none;
      padding: 14px;
      font: inherit;
      font-size: 17px;
      letter-spacing: 0.04em;
      background: transparent;
    }
    .pc-hint {
      margin: 8px 0 0;
      font-size: 13px;
      color: var(--body);
    }
    .pc-hint.pc-error,
    .pc-alert {
      color: #b42318;
    }
    .pc-action {
      margin-top: 18px;
    }
    .pc-sent {
      margin: 0 0 14px;
      color: var(--body);
    }
    .pc-sent strong {
      color: var(--ink);
      white-space: nowrap;
    }
    .pc-code {
      display: block;
      width: 100%;
      box-sizing: border-box;
      text-align: center;
      font: inherit;
      font-size: 26px;
      font-weight: 600;
      letter-spacing: 0.6em;
      padding: 14px 0 14px 0.6em;
      border: 1px solid var(--outline);
      border-radius: 12px;
      outline: none;
    }
    .pc-code:focus {
      border-color: var(--primary);
      box-shadow: 0 0 0 3px rgba(113, 78, 160, 0.18);
    }
    .pc-resend {
      margin: 14px 0 0;
      text-align: center;
      font-size: 14px;
      color: var(--body);
    }
    .pc-link {
      background: none;
      border: 0;
      padding: 0 2px;
      font: inherit;
      font-weight: 600;
      color: var(--primary);
      text-decoration: underline;
      cursor: pointer;
    }
    .pc-link:disabled {
      opacity: 0.5;
      cursor: default;
    }
    .pc-alert {
      margin: 14px 0 0;
      font-size: 14px;
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }
  `,
})
export class PhoneCode implements OnDestroy {
  protected readonly store = inject(WebsiteStore);
  readonly mode = input<'sign-in' | 'verify'>('sign-in');
  readonly initialNumber = input<string | undefined>(undefined);
  /** Sign-in needs the terms box ticked first; verifying a number does not. */
  readonly canSend = input(true);
  readonly done = output<void>();
  protected readonly step = signal<'phone' | 'code'>('phone');
  protected readonly typed = signal<string | null>(null);
  protected readonly number = computed(
    () => this.typed() ?? (this.initialNumber() ?? '').replace(/^\+91/, ''),
  );
  protected readonly phone = computed(() => indianMobile(this.number()));
  protected readonly shownPhone = computed(() => displayMobile(this.phone() ?? ''));
  protected readonly showNumberError = computed(
    () => this.number().replace(/\D/g, '').length >= 10 && !this.phone(),
  );
  protected readonly code = signal('');
  protected readonly secondsLeft = signal(0);
  private timer: ReturnType<typeof setInterval> | null = null;

  protected onCode(value: string): void {
    const digits = (value ?? '').replace(/\D/g, '').slice(0, 6);
    this.code.set(digits);
    if (digits.length === 6) void this.check();
  }

  protected async send(): Promise<void> {
    const phone = this.phone();
    if (!phone || this.store.busy() || !this.canSend()) return;
    this.typed.set(this.number());
    const ok =
      this.mode() === 'sign-in'
        ? await this.store.sendSignInCode(phone)
        : await this.store.sendMobileCode(phone);
    if (ok) {
      this.code.set('');
      this.step.set('code');
      this.startResendTimer();
    }
  }

  protected async check(): Promise<void> {
    const phone = this.phone();
    const code = this.code();
    if (!phone || code.length !== 6 || this.store.busy()) return;
    const ok =
      this.mode() === 'sign-in'
        ? await this.store.verifySignInCode(phone, code)
        : await this.store.confirmMobileCode(phone, code);
    if (ok) this.done.emit();
  }

  protected back(): void {
    this.step.set('phone');
    this.code.set('');
    this.store.error.set('');
  }

  private startResendTimer(): void {
    this.stopTimer();
    this.secondsLeft.set(RESEND_SECONDS);
    this.timer = setInterval(() => {
      const left = this.secondsLeft() - 1;
      this.secondsLeft.set(Math.max(0, left));
      if (left <= 0) this.stopTimer();
    }, 1000);
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  ngOnDestroy(): void {
    this.stopTimer();
  }
}
