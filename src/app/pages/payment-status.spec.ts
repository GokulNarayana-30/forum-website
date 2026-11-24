import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { checkedPayuCheckoutUrl } from '../core/store';
import { WebsiteStore } from '../core/store';
import { PaymentStatus, appReturnLink } from './payment-status';

const orderId = 'abcdabcd-abcd-4bcd-8bcd-abcdabcdabcd';
const status = {
  order_id: orderId,
  payment_state: 'paid',
  expires_at: null,
  can_retry: false,
  can_switch: false,
};

describe('Website payment return', () => {
  let read: ReturnType<typeof vi.fn>;
  let booking: ReturnType<typeof vi.fn>;
  let start: ReturnType<typeof vi.fn>;
  let switchPayu: ReturnType<typeof vi.fn>;
  const signedIn = signal(true);
  const profile = signal<{ id: string } | null>({ id: 'owner-one' });
  function mount({ platform = 'browser', id = orderId, embedded = false, app = false } = {}) {
    TestBed.configureTestingModule({
      imports: [PaymentStatus],
      providers: [
        provideRouter([]),
        { provide: PLATFORM_ID, useValue: platform },
        {
          provide: ActivatedRoute,
          useValue: {
            queryParamMap: of(
              convertToParamMap({
                order: id,
                status: 'success',
                txnid: 'ignore',
                ...(app ? { app: '1' } : {}),
              }),
            ),
          },
        },
        {
          provide: WebsiteStore,
          useValue: {
            ready: signal(true),
            signedIn,
            profile,
            preview: signal(false),
            initialPayuFeedback: signal(null),
            paymentStatus: read,
            paymentBooking: booking,
            switchPayu,
            startPayu: start,
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(PaymentStatus);
    if (embedded) fixture.componentRef.setInput('orderId', id);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    signedIn.set(true);
    profile.set({ id: 'owner-one' });
    read = vi.fn().mockResolvedValue(status);
    start = vi.fn().mockResolvedValue('failed');
    booking = vi.fn().mockResolvedValue({
      booking_ref: 'FL-2026-000022',
      total_paise: 45000,
      slot_starts_at: '2026-11-22T07:00:00+05:30',
      slot_ends_at: '2026-11-22T08:00:00+05:30',
      patients: [{ id: 'p1', first_name: 'Asha', relation: 'self' }],
      lines: [{ test_name: 'Complete Haemogram', amount_paise: 45000 }],
    });
    switchPayu = vi.fn().mockResolvedValue('payu_checkout_pending');
  });
  afterEach(() => TestBed.resetTestingModule());

  describe('a payment started in the app (owner, 2026-11-22)', () => {
    it('hands back to the app instead of asking to sign in', () => {
      signedIn.set(false);
      const fixture = mount({ platform: 'server', app: true });
      const text = fixture.nativeElement.textContent as string;
      expect(text).toContain('Taking you back to the Forum Labs app');
      expect(text).not.toContain('Sign in');
      const link = fixture.nativeElement.querySelector('a.button') as HTMLAnchorElement;
      expect(link.getAttribute('href')).toBe(appReturnLink(orderId));
    });

    it('the link opens only the Forum Labs app with a checked order id, else My bookings', () => {
      expect(appReturnLink(orderId)).toBe(
        `intent://app/payment-return?order=${orderId}#Intent;scheme=forumlabs;` +
          'package=com.forumhospital.forum_labs;S.browser_fallback_url=https%3A%2F%2Fforumlabs.in%2Fbookings;end',
      );
      expect(appReturnLink(null)).toContain('intent://app/payment-return#Intent;');
    });

    it('the automatic attempt has no website fallback, so a blocked attempt never lands on sign-in (2026-11-24)', () => {
      expect(appReturnLink(orderId, false)).toBe(
        `intent://app/payment-return?order=${orderId}#Intent;scheme=forumlabs;package=com.forumhospital.forum_labs;end`,
      );
      expect(appReturnLink(orderId, false)).not.toContain('browser_fallback_url');
    });

    it('a booking card on the website never shows it, even with app=1', () => {
      const fixture = mount({ platform: 'server', app: true, embedded: true });
      expect(fixture.nativeElement.textContent).not.toContain('Taking you back to the Forum Labs app');
    });
  });

  it('accepts only the hosted checkout URL shape from the API', () => {
    const valid = 'https://apitest.payu.in/public/#/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    expect(checkedPayuCheckoutUrl(valid)).toBe(valid);
    expect(
      checkedPayuCheckoutUrl(valid.replace('apitest.payu.in', 'apitest.payu.in.attacker.test')),
    ).toBeNull();
    expect(checkedPayuCheckoutUrl(valid.replace('/public/', '/public/?target=evil'))).toBeNull();
    expect(checkedPayuCheckoutUrl(valid.replace('https://', 'https://x@'))).toBeNull();
  });

  it('starts at checking and accepts paid only from the owned server response', async () => {
    let answer!: (value: typeof status) => void;
    read.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const fixture = mount();
    expect(fixture.nativeElement.textContent).toContain('Processing your payment');
    expect(fixture.nativeElement.textContent).not.toContain('Payment confirmed');
    expect(read).toHaveBeenCalledExactlyOnceWith(orderId);
    answer(status);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Payment confirmed');
    expect(fixture.nativeElement.textContent).not.toContain('ignore');
  });

  it('honors the switch flag and waits for a new server decision after a refusal', async () => {
    const pending = {
      ...status,
      payment_state: 'retryable',
      can_switch: true,
      expires_at: '2026-11-21T09:30:00Z',
    };
    read
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce({ ...pending, payment_state: 'checking' });
    const fixture = mount();
    await fixture.whenStable();
    fixture.detectChanges();
    const button = [
      ...(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>),
    ].find((item) => item.textContent?.includes('Pay at collection'));
    expect(button).toBeDefined();
    button!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(switchPayu).toHaveBeenCalledExactlyOnceWith(orderId);
    expect(read).toHaveBeenCalledTimes(2);
    expect(fixture.nativeElement.textContent).toContain('Processing your payment');
    expect(fixture.nativeElement.textContent).not.toContain('Payment confirmed');
  });

  // Owner, 2026-11-21: while our own Verify confirms PayU's reply, say so plainly and never invite a second payment.
  it('shows processing with a calm note and no retry while the server checks the payment', async () => {
    read.mockResolvedValue({ ...status, payment_state: 'checking', can_retry: false, can_switch: true });
    const fixture = mount();
    await fixture.whenStable();
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Processing your payment');
    expect(text).toContain('Please don’t pay again');
    expect(fixture.nativeElement.querySelector('.processing-spinner')).not.toBeNull();
    expect(text).not.toContain('Try payment again');
  });

  // Owner, 2026-11-21: the server sends a fallback email, so no state asks for one unless the server requires it.
  it.each(['paid', 'checking', 'retryable', 'awaiting_payment', 'expired'])('shows no email box when %s', async (state) => {
    read.mockResolvedValue({ ...status, payment_state: state, can_retry: state === 'retryable' || state === 'awaiting_payment',
      can_switch: false });
    const fixture = mount();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input[type=email]')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Skip email');
  });

  // Owner, 2026-11-21: a manual check whose answer is unchanged looked like nothing happened.
  it('shows Checking… while a manual check runs, then when it was checked', async () => {
    read.mockResolvedValue({ ...status, payment_state: 'retryable', can_retry: true, can_switch: false });
    const fixture = mount();
    await fixture.whenStable();
    fixture.detectChanges();
    let answer!: (value: unknown) => void;
    read.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    const check = () => [...(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)]
      .find((button) => /Check status|Checking/.test(button.textContent ?? ''))!;
    check().click();
    fixture.detectChanges();
    expect(check().textContent).toContain('Checking…');
    expect(check().disabled).toBe(true);
    answer({ ...status, payment_state: 'retryable', can_retry: true, can_switch: false });
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    expect(check().textContent).toContain('Check status');
    expect(fixture.nativeElement.textContent).toMatch(/Checked at .+ IST\. No change yet\./);
  });

  // Owner test, 2026-11-22: PayU's test system did not answer, so no payment started.
  it('says PayU could not be reached and nothing was charged when a start fails, once', async () => {
    read.mockResolvedValue({ ...status, payment_state: 'retryable', can_retry: true, can_switch: true });
    const fixture = mount();
    await fixture.whenStable();
    fixture.detectChanges();
    const retry = [...(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)]
      .find((button) => button.textContent?.includes('Try payment again'))!;
    retry.click();
    await fixture.whenStable();
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('We couldn’t reach PayU just now');
    expect(text).toContain('nothing was charged');
    expect(text).not.toContain('Your payment didn’t go through');
  });

  it('names an unfinished payment plainly and offers the retry', async () => {
    read.mockResolvedValue({ ...status, payment_state: 'retryable', can_retry: true, can_switch: true });
    const fixture = mount();
    await fixture.whenStable();
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Payment not completed');
    expect(text).toContain('Try payment again');
    expect(fixture.nativeElement.querySelector('.processing-spinner')).toBeNull();
  });

  it('keeps checking for up to two minutes while processing, then stops', async () => {
    vi.useFakeTimers();
    try {
      read.mockResolvedValue({ ...status, payment_state: 'checking', can_retry: false });
      const fixture = mount();
      await vi.advanceTimersByTimeAsync(300_000);
      expect(read).toHaveBeenCalledTimes(40);
      fixture.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  // Owner, 2026-11-21: the result page is a proper confirmation, not a bare heading.
  it('confirms a paid booking with its details and the next steps', async () => {
    const fixture = mount();
    await fixture.whenStable();
    // The booking details load just after the status answer.
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const text = el.textContent ?? '';
    expect(text).toContain('Payment confirmed');
    expect(text).toContain('Your home collection is booked and paid');
    expect(text).toContain('FL-2026-000022');
    expect(text).toContain('₹450.00');
    expect(text).toContain('Complete Haemogram');
    expect(text).toContain('Asha');
    expect(text).toContain('7:00 – 8:00 am');
    expect(el.querySelector('.pay-icon.success')).not.toBeNull();
    expect(el.querySelector('a[href="/bookings"]')?.textContent).toContain('View my bookings');
    expect(el.querySelector('a[href="/tests"]')?.textContent).toContain('Book another test');
    expect(text).not.toContain('Check status');
  });

  it('shows the amount and reference while processing', async () => {
    read.mockResolvedValue({ ...status, payment_state: 'checking', can_retry: false, can_switch: false });
    const fixture = mount();
    await fixture.whenStable();
    // The booking details load just after the status answer.
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('FL-2026-000022');
    expect(text).toContain('₹450.00');
    expect(fixture.nativeElement.querySelector('.pay-icon.processing')).not.toBeNull();
  });

  it('offers no switch to pay at collection while the payment is being confirmed', async () => {
    read.mockResolvedValue({ ...status, payment_state: 'checking', can_retry: false, can_switch: true });
    const fixture = mount();
    await fixture.whenStable();
    fixture.detectChanges();
    const buttons = [...(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)];
    expect(buttons.some((button) => button.textContent?.includes('Pay at collection'))).toBe(false);
  });

  it('stays compact inside a booking card: no details block and no booking read', async () => {
    const fixture = mount({ embedded: true });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Payment confirmed');
    expect(fixture.nativeElement.querySelector('.pay-details')).toBeNull();
    expect(booking).not.toHaveBeenCalled();
  });

  it('bounds polling and removes the timer on teardown', async () => {
    vi.useFakeTimers();
    try {
      read.mockResolvedValue({ ...status, payment_state: 'retryable' });
      const fixture = mount();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(read).toHaveBeenCalledTimes(8);
      fixture.destroy();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(read).toHaveBeenCalledTimes(8);
    } finally {
      vi.useRealTimers();
    }
  });

  it('makes no server read for SSR, even with a valid order locator', () => {
    mount({ platform: 'server' });
    expect(read).not.toHaveBeenCalled();
  });

  it('ignores an in-flight answer from a previous signed-in account', async () => {
    let answer!: (value: typeof status) => void;
    read
      .mockReturnValueOnce(
        new Promise((resolve) => {
          answer = resolve;
        }),
      )
      .mockRejectedValueOnce(new Error('not found'));
    const fixture = mount();
    profile.set({ id: 'owner-two' });
    fixture.detectChanges();
    answer(status);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Payment confirmed');
  });
});
