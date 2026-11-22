import { TestBed } from '@angular/core/testing';
import { FastingDialog } from './fasting-dialog';

describe('Fasting popup (owner, 2026-11-22)', () => {
  function mount(inputs: Record<string, unknown>) {
    const fixture = TestBed.createComponent(FastingDialog);
    for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
    fixture.detectChanges();
    return fixture;
  }
  afterEach(() => TestBed.resetTestingModule());

  it('shows the fasting hours, the lab instructions and one OK button', () => {
    const fixture = mount({ open: true, minHours: 10, maxHours: 12, instructions: ['Water is allowed.'] });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[role=dialog]')).not.toBeNull();
    expect(el.textContent).toContain('Fasting required');
    expect(el.textContent).toContain('Fast for 10–12 hours before your collection.');
    expect(el.textContent).toContain('Water is allowed.');
    expect(el.textContent).toContain('Early morning times are best');
    expect(el.querySelectorAll('button')).toHaveLength(1);
  });

  it('says the hours plainly when only one number is known', () => {
    const fixture = mount({ open: true, minHours: 8, maxHours: null, instructions: [] });
    expect(fixture.nativeElement.textContent).toContain('Fast for at least 8 hours before your collection.');
  });

  it('OK tells the page the note was read', () => {
    const fixture = mount({ open: true, minHours: 10, maxHours: 12, instructions: [] });
    let read = 0;
    fixture.componentInstance.acknowledged.subscribe(() => read++);
    (fixture.nativeElement.querySelector('button') as HTMLButtonElement).click();
    expect(read).toBe(1);
  });

  it('renders nothing when closed', () => {
    const fixture = mount({ open: false, minHours: 10, maxHours: 12, instructions: [] });
    expect(fixture.nativeElement.querySelector('[role=dialog]')).toBeNull();
  });
});
