import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { WebsiteApi, WebsiteError } from '../core/api';
import { WebsiteStore } from '../core/store';
import { Order } from '../core/models';
import { BookingStatus } from './booking-status';
import { Journey } from './journey';

const order: Order = {
  id: 'sample-order',
  booking_ref: 'SAMPLE-001',
  status: 'confirmed',
  total_paise: 10000,
  slot_starts_at: '2026-11-03T03:30:00Z',
  patients: [],
};
const history = (id = order.id) => ({
  order_id: id,
  events: [{ kind: 'on_the_way', at: '2026-11-03T03:00:00Z' }],
});

describe('Booking status feedback', () => {
  const request = vi.fn();
  beforeEach(() => {
    request.mockReset();
    TestBed.configureTestingModule({
      imports: [BookingStatus],
      providers: [provideRouter([]), { provide: WebsiteApi, useValue: { request } }],
    });
  });
  afterEach(() => TestBed.resetTestingModule());

  async function render() {
    const fixture = TestBed.createComponent(BookingStatus);
    fixture.componentRef.setInput('order', order);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('opens immediately with the booking summary and loading feedback', async () => {
    request.mockReturnValue(new Promise(() => {}));
    const fixture = await render();
    expect(fixture.nativeElement.textContent).toContain('SAMPLE-001 · Status');
    expect(fixture.nativeElement.textContent).toContain('Confirmed');
    expect(fixture.nativeElement.querySelector('[role="status"]').textContent).toContain('Loading');
    expect(request).toHaveBeenCalledWith('/orders/sample-order/tracking');
  });

  it('renders API event kinds as readable updates with IST times', async () => {
    request.mockResolvedValue(history());
    const fixture = await render();
    expect(fixture.nativeElement.textContent).toContain('On the way');
    expect(fixture.nativeElement.querySelector('time').textContent).toContain('8:30 am IST');
    expect(fixture.nativeElement.querySelector('[role="status"]')).toBeNull();
  });

  it('explains an empty history instead of leaving a blank panel', async () => {
    request.mockResolvedValue({ order_id: order.id, events: [] });
    const fixture = await render();
    expect(fixture.nativeElement.textContent).toContain('No tracking updates yet.');
    expect(fixture.nativeElement.textContent).toContain('Confirmed');
  });

  it('shows a local failure and retries the selected booking', async () => {
    request.mockRejectedValueOnce(new WebsiteError('network', 'Connection interrupted.'));
    const fixture = await render();
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain(
      'Connection interrupted.',
    );
    request.mockResolvedValueOnce(history());
    fixture.nativeElement.querySelector('button').click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(request).toHaveBeenCalledTimes(2);
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('On the way');
  });

  it.each([
    { order_id: 'another-order', events: [] },
    { order_id: order.id, events: [{ kind: 'confirmed', at: 'invalid-date' }] },
    { order_id: order.id },
  ])('shows a recoverable error for malformed or mismatched history: %j', async (result) => {
    request.mockResolvedValue(result);
    const fixture = await render();
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain(
      'could not be read',
    );
    expect(fixture.nativeElement.querySelector('button').textContent).toContain('Retry status');
  });

  it('ignores an old response after the selected booking changes', async () => {
    let resolveOld!: (value: unknown) => void;
    request.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
    );
    const fixture = await render();
    request.mockResolvedValueOnce({ order_id: 'second-order', events: [] });
    fixture.componentRef.setInput('order', {
      ...order,
      id: 'second-order',
      booking_ref: 'SAMPLE-002',
    });
    fixture.detectChanges();
    await fixture.whenStable();
    resolveOld(history());
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('SAMPLE-002');
    expect(fixture.nativeElement.textContent).toContain('No tracking updates yet.');
    expect(fixture.nativeElement.textContent).not.toContain('On the way');
  });
});

describe('My bookings status button', () => {
  afterEach(() => TestBed.resetTestingModule());
  it('opens under the clicked card, closes on another click, and clears on sign-out', async () => {
    const signedIn = signal(true);
    TestBed.configureTestingModule({
      imports: [Journey],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { data: of({ view: 'bookings' }), queryParamMap: of(convertToParamMap({})) },
        },
        { provide: WebsiteApi, useValue: { request: vi.fn().mockResolvedValue(history()) } },
        {
          provide: WebsiteStore,
          useValue: {
            ready: signal(false),
            signedIn,
            busy: signal(false),
            preview: signal(false),
            orders: signal([order, { ...order, id: 'second-order', booking_ref: 'SAMPLE-002' }]),
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(Journey);
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('.booking-card button') as HTMLButtonElement;
    button.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.closest('article')?.nextElementSibling?.tagName).toBe('FORUM-BOOKING-STATUS');
    expect(fixture.nativeElement.querySelector('forum-booking-status').textContent).toContain(
      'On the way',
    );
    button.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('forum-booking-status')).toBeNull();
    button.click();
    fixture.detectChanges();
    signedIn.set(false);
    fixture.detectChanges();
    signedIn.set(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('forum-booking-status')).toBeNull();
  });
});
