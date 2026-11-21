import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { checkedPayuCheckoutUrl } from '../core/store';
import { WebsiteStore } from '../core/store';
import { PaymentStatus } from './payment-status';

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
  let switchPayu: ReturnType<typeof vi.fn>;
  const signedIn = signal(true);
  const profile = signal<{ id: string } | null>({ id: 'owner-one' });
  function mount({ platform = 'browser', id = orderId } = {}) {
    TestBed.configureTestingModule({
      imports: [PaymentStatus],
      providers: [
        provideRouter([]),
        { provide: PLATFORM_ID, useValue: platform },
        {
          provide: ActivatedRoute,
          useValue: {
            queryParamMap: of(convertToParamMap({ order: id, status: 'success', txnid: 'ignore' })),
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
            switchPayu,
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(PaymentStatus);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    signedIn.set(true);
    profile.set({ id: 'owner-one' });
    read = vi.fn().mockResolvedValue(status);
    switchPayu = vi.fn().mockResolvedValue('payu_checkout_pending');
  });
  afterEach(() => TestBed.resetTestingModule());

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
    expect(fixture.nativeElement.textContent).toContain('Checking your payment');
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
    expect(fixture.nativeElement.textContent).toContain('Checking your payment');
    expect(fixture.nativeElement.textContent).not.toContain('Payment confirmed');
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
