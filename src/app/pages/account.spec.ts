import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { WebsiteStore } from '../core/store';
import { Account } from './account';

function fakeStore() {
  return {
    signedIn: signal(true),
    busy: signal(false),
    preview: signal(false),
    canEdit: signal(true),
    error: signal(''),
    profile: signal({
      name: 'Sample customer',
      date_of_birth: '1990-01-01',
      gender: 'male',
      phone: '+919876543210',
      email: 'sample@example.invalid',
    }),
    people: signal([
      { id: 'me', name: 'Sample customer', relation: 'self' },
      { id: 'family', name: 'Sample relative', relation: 'parent' },
    ]),
    addresses: signal([]),
    saveProfile: vi.fn().mockResolvedValue(undefined),
    addFamily: vi.fn().mockResolvedValue(undefined),
    addAddress: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn(),
  };
}
describe('Customer account sections', () => {
  let store: ReturnType<typeof fakeStore>;
  beforeEach(() => {
    store = fakeStore();
    TestBed.configureTestingModule({
      imports: [Account],
      providers: [provideRouter([]), { provide: WebsiteStore, useValue: store }],
    });
  });
  afterEach(() => TestBed.resetTestingModule());
  async function render() {
    const fixture = TestBed.createComponent(Account);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }
  function button(root: HTMLElement, text: string) {
    const found = Array.from(root.querySelectorAll('button')).find((b) =>
      b.textContent?.includes(text),
    );
    if (!found) throw new Error('Missing button: ' + text);
    return found;
  }
  it('starts with a read-only profile and counts family without the account holder', async () => {
    const fixture = await render();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('form')).toBeNull();
    expect(root.querySelector('dd')?.textContent).toContain('Sample customer');
    expect(button(root, 'Family members').querySelector('small')?.textContent).toBe('1');
    button(root, 'Family members').click();
    fixture.detectChanges();
    expect(root.querySelector('.records')?.textContent).toContain('Sample relative');
    expect(root.querySelector('.records')?.textContent).not.toContain('Sample customer');
  });
  it('opens current details, saves through the existing store, and confirms success', async () => {
    const fixture = await render();
    const root: HTMLElement = fixture.nativeElement;
    button(root, 'Edit details').click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect((root.querySelector('[name="name"]') as HTMLInputElement).value).toBe('Sample customer');
    button(root, 'Save details').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(store.saveProfile).toHaveBeenCalledWith(
      'Sample customer',
      '1990-01-01',
      'male',
      '+919876543210',
    );
    expect(root.querySelector('form')).toBeNull();
    expect(root.querySelector('[role="status"]')?.textContent).toContain('have been saved');
  });
  it('keeps failed input open without showing success', async () => {
    store.saveProfile.mockImplementation(async () => {
      store.error.set('Connection interrupted.');
    });
    const fixture = await render();
    const root: HTMLElement = fixture.nativeElement;
    button(root, 'Edit details').click();
    fixture.detectChanges();
    await fixture.whenStable();
    button(root, 'Save details').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(root.querySelector('form')).not.toBeNull();
    expect(root.querySelector('[role="status"]')).toBeNull();
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('Connection interrupted.');
  });
  it('shows the address empty state and cancels additions without saving', async () => {
    const fixture = await render();
    const root: HTMLElement = fixture.nativeElement;
    button(root, 'Saved addresses').click();
    fixture.detectChanges();
    expect(root.textContent).toContain('Your doorstep, saved.');
    button(root, 'Add address').click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(button(root, 'Save address').disabled).toBe(true);
    button(root, 'Cancel').click();
    fixture.detectChanges();
    expect(root.querySelector('form')).toBeNull();
    expect(store.addAddress).not.toHaveBeenCalled();
  });
  it('keeps sample mode read-only and removes an open form on sign-out', async () => {
    const fixture = await render();
    const root: HTMLElement = fixture.nativeElement;
    button(root, 'Edit details').click();
    fixture.detectChanges();
    store.signedIn.set(false);
    fixture.detectChanges();
    expect(root.textContent).toContain('Sign in to your account');
    store.preview.set(true);
    store.signedIn.set(true);
    fixture.detectChanges();
    expect(root.querySelector('form')).toBeNull();
    expect(root.textContent).not.toContain('Edit details');
    button(root, 'Family members').click();
    fixture.detectChanges();
    expect(root.textContent).not.toContain('Add member');
  });
});
