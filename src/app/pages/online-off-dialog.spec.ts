import { TestBed } from '@angular/core/testing';
import { OnlineOffDialog } from './online-off-dialog';

describe('Online payment unavailable popup (owner, 2026-11-23)', () => {
  function mount(open: boolean) {
    const fixture = TestBed.createComponent(OnlineOffDialog);
    fixture.componentRef.setInput('open', open);
    fixture.detectChanges();
    return fixture;
  }
  afterEach(() => TestBed.resetTestingModule());

  it('explains that online payment is down and offers pay at collection or Not now', () => {
    const el = mount(true).nativeElement as HTMLElement;
    expect(el.querySelector('[role=dialog]')).not.toBeNull();
    expect(el.textContent).toContain('Online payment is unavailable');
    expect(el.textContent).toContain('pay the phlebotomist at collection');
    const labels = [...el.querySelectorAll('button')].map((b) => b.textContent?.trim());
    expect(labels).toEqual(['Book and pay at collection', 'Not now']);
  });

  it('each button tells the page what the customer chose', () => {
    const fixture = mount(true);
    let booked = 0;
    let dismissed = 0;
    fixture.componentInstance.book.subscribe(() => booked++);
    fixture.componentInstance.dismissed.subscribe(() => dismissed++);
    const [book, notNow] = fixture.nativeElement.querySelectorAll(
      'button',
    ) as NodeListOf<HTMLButtonElement>;
    notNow.click();
    expect([booked, dismissed]).toEqual([0, 1]);
    book.click();
    expect([booked, dismissed]).toEqual([1, 1]);
  });

  it('renders nothing when closed', () => {
    expect(mount(false).nativeElement.querySelector('[role=dialog]')).toBeNull();
  });
});
