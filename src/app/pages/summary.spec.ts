import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { WebsiteStore } from '../core/store';
import { Summary } from './summary';

const quote = {
  item_total_paise: 45000,
  discount_paise: 0,
  collection_fee_paise: 0,
  taxes_paise: 0,
  to_pay_paise: 45000,
};

describe('Order summary follows the chosen payment (16.2 review)', () => {
  const choice = signal<'payu' | 'pay_at_collection'>('payu');

  function mount() {
    TestBed.configureTestingModule({
      imports: [Summary],
      providers: [
        provideRouter([]),
        {
          provide: WebsiteStore,
          useValue: {
            preview: signal(false),
            quote: signal(quote),
            total: signal(45000),
            lines: signal([]),
            address: signal(null),
            slot: signal(null),
            paymentChoice: choice,
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(Summary);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('says pay online when PayU is chosen, never "no online payment"', () => {
    choice.set('payu');
    const text = mount().textContent ?? '';
    expect(text).toContain('Pay online');
    expect(text).not.toContain('Pay at collection');
    expect(text).not.toContain('No online payment is needed');
  });

  it('keeps the pay at collection wording when that is chosen', () => {
    choice.set('pay_at_collection');
    const text = mount().textContent ?? '';
    expect(text).toContain('Pay at collection');
    expect(text).toContain('No online payment is needed');
  });
});
