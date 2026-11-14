import { Component, PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { App } from '../app';
import { WebsiteApi } from '../core/api';
import { WebsiteStore } from '../core/store';
import { SupportChatService } from '../core/support-chat.service';
import { Journey } from './journey';
import { SupportChat } from './support-chat';

const TICKET_ID = '11111111-1111-4111-8111-111111111111';
const PAST_OPEN_ID = '22222222-2222-4222-8222-222222222222';
const PAST_CLOSED_ID = '33333333-3333-4333-8333-333333333333';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static throwOnConstruct = false;
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readonly url: string;
  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  private listeners = new Map<string, Array<(e: any) => void>>();

  constructor(url: string) {
    if (FakeWebSocket.throwOnConstruct) {
      throw new Error('WebSocket must not be constructed');
    }
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, fn: (e: any) => void): void {
    const arr = this.listeners.get(type) ?? [];
    arr.push(fn);
    this.listeners.set(type, arr);
  }

  removeEventListener(type: string, fn: (e: any) => void): void {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((x) => x !== fn),
    );
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    for (const fn of this.listeners.get('close') ?? []) fn({ code: 1000, reason: '' });
  }

  emitOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    for (const fn of this.listeners.get('open') ?? []) fn({});
  }

  emitMessage(frame: unknown): void {
    for (const fn of this.listeners.get('message') ?? []) {
      fn({ data: JSON.stringify(frame) });
    }
  }
}

function makeJwt(expSeconds: number): string {
  const h = btoa(JSON.stringify({ alg: 'ES256', typ: 'JWT' }));
  const p = btoa(JSON.stringify({ sub: 'user-1', exp: expSeconds, role: 'authenticated' }));
  return `${h}.${p}.sig`;
}

describe('SupportChat page, Help CTA, and PKCE return flow', () => {
  const fakeFetch = vi.fn();

  beforeEach(() => {
    FakeWebSocket.instances = [];
    FakeWebSocket.throwOnConstruct = false;
    vi.stubGlobal('WebSocket', FakeWebSocket);
    fakeFetch.mockReset();
    vi.stubGlobal('fetch', fakeFetch);
  });

  afterEach(() => {
    vi.useRealTimers();
    sessionStorage.clear();
    localStorage.clear();
    history.replaceState(null, '', '/');
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  it('renders SupportChat shell cleanly under SSR (PLATFORM_ID=server) with ZERO WebSocket or HTTP calls', async () => {
    FakeWebSocket.throwOnConstruct = true;
    TestBed.configureTestingModule({
      imports: [SupportChat],
      providers: [provideRouter([]), { provide: PLATFORM_ID, useValue: 'server' }],
    });
    const api = TestBed.inject(WebsiteApi);
    api.config.set({
      mode: 'live',
      apiBaseUrl: 'https://api.example.invalid/v1',
      supabaseUrl: 'https://auth.example.invalid',
      publishableKey: 'sb_publishable_example',
    });

    const fixture = TestBed.createComponent(SupportChat);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Support chat');
    expect(fixture.nativeElement.querySelector('input[type="file"]')).toBeNull();
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it('renders deterministic preview state on /chat and preserves preview disclaimer + Live Chat CTA on /help', async () => {
    FakeWebSocket.throwOnConstruct = true;
    TestBed.configureTestingModule({
      imports: [SupportChat, Journey],
      providers: [
        provideRouter([]),
        { provide: PLATFORM_ID, useValue: 'browser' },
        {
          provide: ActivatedRoute,
          useValue: { data: of({ view: 'help' }), queryParamMap: of(convertToParamMap({})) },
        },
      ],
    });
    const api = TestBed.inject(WebsiteApi);
    api.config.set({ mode: 'preview', apiBaseUrl: '', supabaseUrl: '', publishableKey: '' });
    const store = TestBed.inject(WebsiteStore);
    store.ready.set(true);

    const helpFixture = TestBed.createComponent(Journey);
    helpFixture.detectChanges();
    await helpFixture.whenStable();
    helpFixture.detectChanges();

    const helpText = helpFixture.nativeElement.textContent;
    expect(helpText).toContain('This preview does not send support requests.');
    expect(helpText).toContain('Chat with Forum Labs support');
    expect(helpFixture.nativeElement.querySelector('a[href="/chat"]')).not.toBeNull();
    expect(helpFixture.nativeElement.querySelector('a[href="/bookings"]')).not.toBeNull();
    expect(helpFixture.nativeElement.querySelector('a[href="/reports"]')).not.toBeNull();

    const chatFixture = TestBed.createComponent(SupportChat);
    chatFixture.detectChanges();
    await chatFixture.whenStable();
    chatFixture.detectChanges();

    expect(chatFixture.nativeElement.textContent).toContain('This preview does not send support requests.');
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it('shows availability and Sign-in CTA with next=/chat for guests, and handles safe vs malicious returnTo in live PKCE and preview', async () => {
    TestBed.configureTestingModule({
      imports: [SupportChat],
      providers: [provideRouter([]), { provide: PLATFORM_ID, useValue: 'browser' }],
    });
    const api = TestBed.inject(WebsiteApi);
    api.config.set({
      mode: 'live',
      apiBaseUrl: 'https://api.example.invalid/v1',
      supabaseUrl: 'https://auth.example.invalid',
      publishableKey: 'sb_publishable_example',
    });
    const store = TestBed.inject(WebsiteStore);
    store.ready.set(true);

    fakeFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        online: false,
        reason: 'outside_hours',
        next_open_at: '2026-11-15T03:30:00.000Z',
        opens_in_ist_text: 'Opens tomorrow at 9:00 AM IST',
      }),
    });

    const fixture = TestBed.createComponent(SupportChat);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('Opens tomorrow at 9:00 AM IST');
    });
    const signInLink = fixture.nativeElement.querySelector('a[href^="/sign-in"]') as HTMLAnchorElement;
    expect(signInLink).not.toBeNull();
    expect(signInLink.textContent).toContain('Sign in to start live chat');
    expect(signInLink.getAttribute('href')).toContain('next=%2Fchat');

    // Verify PKCE stores safe returnTo=/chat and rejects malicious next URLs
    const assignSpy = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign: assignSpy });
    await api.signIn('/chat');
    const storedValid = JSON.parse(sessionStorage.getItem('forum-web-pkce')!);
    expect(storedValid.returnTo).toBe('/chat');

    await api.signIn('https://evil.example/phish');
    const storedMalicious = JSON.parse(sessionStorage.getItem('forum-web-pkce')!);
    expect(storedMalicious.returnTo).toBeUndefined();

    // Verify preview Journey.signIn returns to /chat when next=/chat and defaults to /checkout on malicious next
    TestBed.resetTestingModule();
    const navSpy = vi.fn().mockResolvedValue(true);
    TestBed.configureTestingModule({
      imports: [Journey],
      providers: [
        provideRouter([]),
        { provide: Router, useValue: { navigateByUrl: navSpy, url: '/sign-in' } },
        {
          provide: ActivatedRoute,
          useValue: {
            data: of({ view: 'sign-in' }),
            queryParamMap: of(convertToParamMap({ next: '/chat' })),
          },
        },
      ],
    });
    const jApi = TestBed.inject(WebsiteApi);
    jApi.config.set({ mode: 'preview', apiBaseUrl: '', supabaseUrl: '', publishableKey: '' });
    const jStore = TestBed.inject(WebsiteStore);
    jStore.ready.set(true);
    jStore.terms.set(true);

    const jFixture = TestBed.createComponent(Journey);
    jFixture.detectChanges();
    const btn = Array.from(jFixture.nativeElement.querySelectorAll('button')).find((b: any) =>
      b.textContent?.includes('Continue with sample account'),
    ) as HTMLButtonElement;
    btn.click();
    await jFixture.whenStable();
    expect(navSpy).toHaveBeenCalledWith('/chat');

    // Malicious next in preview falls back to /checkout
    TestBed.resetTestingModule();
    navSpy.mockReset();
    TestBed.configureTestingModule({
      imports: [Journey],
      providers: [
        provideRouter([]),
        { provide: Router, useValue: { navigateByUrl: navSpy, url: '/sign-in' } },
        {
          provide: ActivatedRoute,
          useValue: {
            data: of({ view: 'sign-in' }),
            queryParamMap: of(convertToParamMap({ next: '//evil.example' })),
          },
        },
      ],
    });
    TestBed.inject(WebsiteApi).config.set({
      mode: 'preview',
      apiBaseUrl: '',
      supabaseUrl: '',
      publishableKey: '',
    });
    const jStore2 = TestBed.inject(WebsiteStore);
    jStore2.ready.set(true);
    jStore2.terms.set(true);
    const jFixture2 = TestBed.createComponent(Journey);
    jFixture2.detectChanges();
    const btn2 = Array.from(jFixture2.nativeElement.querySelectorAll('button')).find((b: any) =>
      b.textContent?.includes('Continue with sample account'),
    ) as HTMLButtonElement;
    btn2.click();
    await jFixture2.whenStable();
    expect(navSpy).toHaveBeenCalledWith('/checkout');
  });

  it('supports live text-only chat, offline IST notice, typing, read receipts, and own ticket history (open reply vs closed read-only)', async () => {
    TestBed.configureTestingModule({
      imports: [SupportChat],
      providers: [provideRouter([]), { provide: PLATFORM_ID, useValue: 'browser' }],
    });
    const api = TestBed.inject(WebsiteApi);
    api.config.set({
      mode: 'live',
      apiBaseUrl: 'https://api.example.invalid/v1',
      supabaseUrl: 'https://auth.example.invalid',
      publishableKey: 'sb_publishable_example',
    });

    // Sign in via finishSignIn
    history.replaceState(null, '', '/auth/callback?code=c1');
    sessionStorage.setItem(
      'forum-web-pkce',
      JSON.stringify({ verifier: 'a'.repeat(43), expiresAt: Date.now() + 60_000 }),
    );
    fakeFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ access_token: makeJwt(Math.floor(Date.now() / 1000) + 600), expires_in: 600 }),
    });
    await api.finishSignIn();
    fakeFetch.mockReset();

    const store = TestBed.inject(WebsiteStore);
    store.ready.set(true);

    fakeFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/support/chat') && (!init?.method || init.method === 'GET')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ticket: {
              id: TICKET_ID,
              reference: 'FL-CHAT-1',
              category: 'complaint',
              status: 'open',
              channel: 'chat',
              description: 'Fasting question',
              booking_id: null,
              booking_ref: null,
              report_id: null,
              report_released_at: null,
              created_at: '2026-11-14T10:00:00.000Z',
              updated_at: '2026-11-14T10:05:00.000Z',
            },
            messages: [
              { id: 'm1', sender: 'customer', body: 'Do I need fasting?', sent_at: '2026-11-14T10:00:00.000Z', seq: 1 },
            ],
            read_state: {
              ticket_id: TICKET_ID,
              last_seq: 1,
              customer_delivered_seq: 1,
              customer_read_seq: 1,
              staff_delivered_seq: 1,
              staff_read_seq: 0,
              customer_delivered_at: null,
              customer_read_at: null,
              staff_delivered_at: '2026-11-14T10:01:00.000Z',
              staff_read_at: null,
            },
            availability: {
              online: false,
              reason: 'outside_hours',
              next_open_at: '2026-11-15T03:30:00.000Z',
              opens_in_ist_text: 'Opens tomorrow at 9:00 AM IST',
            },
            unread_count: 0,
          }),
        };
      }
      if (url.endsWith('/support/tickets')) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              id: PAST_OPEN_ID,
              reference: 'FL-OLD-OPEN',
              category: 'booking',
              status: 'open',
              channel: 'app',
              unread_count: 1,
              description: 'Slot change',
              booking_id: null,
              booking_ref: null,
              report_id: null,
              report_released_at: null,
              created_at: '2026-11-10T10:00:00.000Z',
              updated_at: '2026-11-10T11:00:00.000Z',
            },
            {
              id: PAST_CLOSED_ID,
              reference: 'FL-OLD-CLOSED',
              category: 'report',
              status: 'resolved',
              channel: 'chat',
              unread_count: 0,
              description: 'Old resolved chat',
              booking_id: null,
              booking_ref: null,
              report_id: null,
              report_released_at: null,
              created_at: '2026-11-01T10:00:00.000Z',
              updated_at: '2026-11-01T11:00:00.000Z',
            },
          ],
        };
      }
      if (url.endsWith('/support/unread')) {
        return { ok: true, status: 200, json: async () => ({ total_unread: 1, chat_unread: 0 }) };
      }
      if (url.endsWith(`/support/tickets/${PAST_OPEN_ID}`)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ticket: {
              id: PAST_OPEN_ID,
              reference: 'FL-OLD-OPEN',
              category: 'booking',
              status: 'open',
              channel: 'app',
              description: 'Slot change',
              booking_id: null,
              booking_ref: null,
              report_id: null,
              report_released_at: null,
              created_at: '2026-11-10T10:00:00.000Z',
              updated_at: '2026-11-10T11:00:00.000Z',
            },
            messages: [
              { id: 'desc-open', sender: 'customer', body: 'Please move slot', sent_at: '2026-11-10T10:00:00.000Z' },
            ],
          }),
        };
      }
      if (url.endsWith(`/support/tickets/${PAST_OPEN_ID}/messages`) && init?.method === 'POST') {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: 'reply-open-1',
            sender: 'customer',
            body: 'Morning slot works',
            sent_at: '2026-11-14T11:05:00.000Z',
            seq: 1,
          }),
        };
      }
      if (url.endsWith(`/support/tickets/${PAST_CLOSED_ID}`)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ticket: {
              id: PAST_CLOSED_ID,
              reference: 'FL-OLD-CLOSED',
              category: 'report',
              status: 'resolved',
              channel: 'chat',
              description: 'Old resolved chat',
              booking_id: null,
              booking_ref: null,
              report_id: null,
              report_released_at: null,
              created_at: '2026-11-01T10:00:00.000Z',
              updated_at: '2026-11-01T11:00:00.000Z',
            },
            messages: [
              { id: 'old-c1', sender: 'support', body: 'Report was shared.', sent_at: '2026-11-01T10:15:00.000Z', seq: null },
            ],
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    const fixture = TestBed.createComponent(SupportChat);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // Wait for async live chat bootstrap and WS connection
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('input[type="file"]')).toBeNull();
    expect(root.textContent).toContain('Opens tomorrow at 9:00 AM IST');
    expect(root.textContent).toContain('Do I need fasting?');
    expect(root.textContent).toContain('Delivered');

    // Live WebSocket message & typing indicator
    const ws = FakeWebSocket.instances[0];
    ws.emitOpen();
    ws.emitMessage({
      type: 'auth.ok',
      mode: 'customer',
      expires_at: new Date(Date.now() + 600_000).toISOString(),
      availability: { online: true, reason: 'online', next_open_at: null, opens_in_ist_text: null },
    });

    ws.emitMessage({
      type: 'chat.typing',
      ticket_id: TICKET_ID,
      actor: 'support',
      is_typing: true,
      expires_at: new Date(Date.now() + 4000).toISOString(),
    });
    fixture.detectChanges();
    expect(root.textContent).toContain('Forum Labs support is typing');

    ws.emitMessage({
      type: 'chat.message',
      ticket_id: TICKET_ID,
      message: {
        id: 'm2',
        sender: 'support',
        body: 'Yes, 10 hours fasting is advised.',
        sent_at: '2026-11-14T11:02:00.000Z',
        seq: 2,
      },
    });
    fixture.detectChanges();
    expect(root.textContent).toContain('Yes, 10 hours fasting is advised.');

    // History: open ticket allows reply, resolved ticket is read-only
    const openBtn = Array.from(root.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('FL-OLD-OPEN'),
    ) as HTMLButtonElement;
    openBtn.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(root.textContent).toContain('Please move slot');
    const histInput = root.querySelector('textarea[name="historyReply"]') as HTMLTextAreaElement;
    expect(histInput).not.toBeNull();
    histInput.value = 'Morning slot works';
    histInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    const sendHistBtn = Array.from(root.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Send reply'),
    ) as HTMLButtonElement;
    sendHistBtn.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(root.textContent).toContain('Morning slot works');

    const closedBtn = Array.from(root.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('FL-OLD-CLOSED'),
    ) as HTMLButtonElement;
    closedBtn.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(root.textContent).toContain('Report was shared.');
    expect(root.querySelector('textarea[name="historyReply"]')).toBeNull();

    // Ensure zero chat text leaked into storage
    const dumpedStorage = [...Object.values(localStorage), ...Object.values(sessionStorage)].join(' ');
    expect(dumpedStorage).not.toContain('Do I need fasting?');
    expect(dumpedStorage).not.toContain('Morning slot works');
  });

  it('shows unread badge on Help link in app.html, refreshes on Help navigation/focus, and clears on sign-out', async () => {
    @Component({ selector: 'forum-help-stub', template: '' })
    class HelpStub {}

    const unreadSignal = signal({ total_unread: 2, chat_unread: 1 });
    const signedInSignal = signal(true);
    const refreshUnread = vi.fn().mockResolvedValue({ total_unread: 2, chat_unread: 1 });

    TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([{ path: 'help', component: HelpStub }]),
        { provide: PLATFORM_ID, useValue: 'browser' },
        {
          provide: WebsiteStore,
          useValue: {
            preview: signal(false),
            busy: signal(false),
            error: signal(''),
            message: signal(''),
            ready: signal(true),
            signedIn: signedInSignal,
            lines: signal([]),
            initialize: vi.fn().mockResolvedValue(undefined),
            consumeSignInReturn: vi.fn().mockReturnValue(null),
          },
        },
        {
          provide: SupportChatService,
          useValue: {
            unread: unreadSignal,
            canConnectLive: () => signedInSignal(),
            refreshUnread,
          },
        },
      ],
    });

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const badge = fixture.nativeElement.querySelector('a[href="/help"] .help-unread-badge');
    expect(badge?.textContent?.trim()).toBe('2');

    // Navigating to /help refreshes unread
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/help');
    fixture.detectChanges();
    expect(refreshUnread).toHaveBeenCalled();

    // Signing out clears badge
    unreadSignal.set({ total_unread: 0, chat_unread: 0 });
    signedInSignal.set(false);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('a[href="/help"] .help-unread-badge')).toBeNull();
  });
});
