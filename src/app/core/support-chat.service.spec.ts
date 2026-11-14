import { PLATFORM_ID, provideAppInitializer, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import wsFixture from '../../../../docs/api/fixtures/support-chat-ws.json';
import { WebsiteApi, WebsiteError } from './api';
import { WebsiteStore } from './store';
import { SupportChatService } from './support-chat.service';

const TICKET_ID = '11111111-1111-4111-8111-111111111111';
const CANARY_BODY = 'CANARY_CHAT_BODY_FASTING_991';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static throwOnConstruct = false;
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readonly url: string;
  readonly protocols?: string | string[];
  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  closedWith: Array<{ code?: number; reason?: string }> = [];

  private listeners = new Map<string, Array<(event: any) => void>>();

  constructor(url: string, protocols?: string | string[]) {
    if (FakeWebSocket.throwOnConstruct) {
      throw new Error('WebSocket must not be constructed in this context');
    }
    this.url = url;
    this.protocols = protocols;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: any) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, listener: (event: any) => void): void {
    const list = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      list.filter((l) => l !== listener),
    );
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.closedWith.push({ code, reason });
    this.emit('close', { code: code ?? 1000, reason: reason ?? '' });
  }

  emitOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.emit('open', {});
  }

  emitMessage(frame: unknown): void {
    this.emit('message', { data: JSON.stringify(frame) });
  }

  emitClose(code: number, reason = ''): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit('close', { code, reason });
  }

  private emit(type: string, event: any): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener(event);
    }
  }
}

function makeJwt(expSeconds: number, sub = 'user-1'): string {
  const header = btoa(JSON.stringify({ alg: 'ES256', typ: 'JWT' }));
  const payload = btoa(JSON.stringify({ sub, exp: expSeconds, role: 'authenticated' }));
  return `${header}.${payload}.sig`;
}

describe('SupportChatService', () => {
  const fakeFetch = vi.fn();

  function setup(options: { platform?: 'browser' | 'server'; mode?: 'live' | 'preview' } = {}) {
    FakeWebSocket.instances = [];
    FakeWebSocket.throwOnConstruct = false;
    vi.stubGlobal('WebSocket', FakeWebSocket);
    fakeFetch.mockReset();
    vi.stubGlobal('fetch', fakeFetch);

    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useValue: options.platform ?? 'browser' },
        WebsiteApi,
        WebsiteStore,
        SupportChatService,
      ],
    });

    const api = TestBed.inject(WebsiteApi);
    api.config.set(
      options.mode === 'preview'
        ? { mode: 'preview', apiBaseUrl: '', supabaseUrl: '', publishableKey: '' }
        : {
            mode: 'live',
            apiBaseUrl: 'https://api.example.invalid/v1',
            supabaseUrl: 'https://auth.example.invalid',
            publishableKey: 'sb_publishable_example',
          },
    );
    const store = TestBed.inject(WebsiteStore);
    const service = TestBed.inject(SupportChatService);
    return { api, store, service };
  }

  async function signInLive(api: WebsiteApi, token: string, refresh = 'refresh-1', expiresIn = 120) {
    history.replaceState(null, '', '/auth/callback?code=auth-code-1');
    sessionStorage.setItem(
      'forum-web-pkce',
      JSON.stringify({ verifier: 'a'.repeat(43), expiresAt: Date.now() + 60_000 }),
    );
    fakeFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: token,
        expires_in: expiresIn,
        refresh_token: refresh,
      }),
    });
    await api.finishSignIn();
    fakeFetch.mockReset();
  }

  afterEach(() => {
    vi.useRealTimers();
    sessionStorage.clear();
    localStorage.clear();
    history.replaceState(null, '', '/');
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  it('never constructs WebSocket or calls fetch under PLATFORM_ID=server (SSR/prerender)', async () => {
    const { api, service } = setup({ platform: 'server', mode: 'live' });
    FakeWebSocket.throwOnConstruct = true;

    expect(service.canConnectLive()).toBe(false);
    await service.loadAvailability();
    await service.loadChatBootstrap();
    await service.sendChatMessage(CANARY_BODY);
    await service.listMyTickets();
    await service.loadMessagesAfter(TICKET_ID, 0);
    await service.markRead(TICKET_ID, 1);
    await service.refreshUnread();
    await service.connect(TICKET_ID);

    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(fakeFetch).not.toHaveBeenCalled();
    expect(await api.accessToken()).toBeNull();
  });

  it('never constructs WebSocket or calls fetch in preview mode', async () => {
    const { store, service } = setup({ platform: 'browser', mode: 'preview' });
    FakeWebSocket.throwOnConstruct = true;
    store.demoSignedIn.set(true);

    expect(service.canConnectLive()).toBe(false);
    await service.loadAvailability();
    await service.loadChatBootstrap();
    await service.sendChatMessage(CANARY_BODY);
    await service.listMyTickets();
    await service.loadTicketThread(TICKET_ID);
    await service.loadMessagesAfter(TICKET_ID, 0);
    await service.markRead(TICKET_ID, 1);
    await service.refreshUnread();
    await service.connect(TICKET_ID);

    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it('never constructs WebSocket or makes authenticated calls for guests', async () => {
    const { service } = setup({ platform: 'browser', mode: 'live' });
    FakeWebSocket.throwOnConstruct = true;

    expect(service.canConnectLive()).toBe(false);
    await service.connect(TICKET_ID);
    await service.loadChatBootstrap();
    await service.sendChatMessage(CANARY_BODY);
    await service.listMyTickets();
    await service.refreshUnread();

    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it('never constructs WebSocket during provideAppInitializer bootstrap', async () => {
    FakeWebSocket.instances = [];
    FakeWebSocket.throwOnConstruct = true;
    vi.stubGlobal('WebSocket', FakeWebSocket);
    fakeFetch.mockReset();
    fakeFetch.mockResolvedValue({ ok: true, status: 200, json: async () => [] });
    vi.stubGlobal('fetch', fakeFetch);

    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useValue: 'browser' },
        WebsiteApi,
        WebsiteStore,
        SupportChatService,
        provideAppInitializer(() => {
          inject(SupportChatService);
          return inject(WebsiteStore).initialize();
        }),
      ],
    });
    const api = TestBed.inject(WebsiteApi);
    api.config.set({ mode: 'preview', apiBaseUrl: '', supabaseUrl: '', publishableKey: '' });

    await expect(TestBed.inject(WebsiteStore).initialize()).resolves.toBeUndefined();
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('connects with first-frame auth only, renews token at 45s pre-expiry, and handles fixture frames', async () => {
    vi.useFakeTimers();
    const baseNow = Date.parse('2026-11-14T11:28:00.000Z');
    vi.setSystemTime(baseNow);

    const { api, service } = setup({ platform: 'browser', mode: 'live' });
    const initialToken = makeJwt(Math.floor(baseNow / 1000) + 120);
    await signInLive(api, initialToken, 'refresh-1', 120);

    await service.connect(TICKET_ID);
    expect(FakeWebSocket.instances).toHaveLength(1);
    const ws = FakeWebSocket.instances[0];
    expect(ws.url).toBe('wss://api.example.invalid/v1/support/chat/ws');
    expect(ws.url).not.toContain('token');
    expect(ws.protocols).toBeUndefined();

    ws.emitOpen();
    expect(JSON.parse(ws.sent[0])).toEqual({
      type: 'auth',
      token: initialToken,
      mode: 'customer',
    });

    const authOkFrame = structuredClone(
      wsFixture.server_frames.find((f) => f.name === 'auth_ok_customer')!.frame,
    );
    (authOkFrame as any).expires_at = new Date(baseNow + 120_000).toISOString();
    ws.emitMessage(authOkFrame);

    expect(service.availability()?.online).toBe(true);
    expect(JSON.parse(ws.sent[1])).toEqual({
      type: 'chat.join',
      ticket_id: TICKET_ID,
      after_seq: 0,
    });

    // Scheduled 45 s before expiry -> triggers renewFromStore and sends auth.refresh with changed token
    const renewedToken = makeJwt(Math.floor(baseNow / 1000) + 3720);
    fakeFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: renewedToken,
        expires_in: 3600,
        refresh_token: 'refresh-2',
      }),
    });

    await vi.advanceTimersByTimeAsync(75_000);
    expect(fakeFetch).toHaveBeenCalledWith(
      'https://auth.example.invalid/auth/v1/token?grant_type=refresh_token',
      expect.objectContaining({ method: 'POST' }),
    );
    const refreshSent = ws.sent.map((s) => JSON.parse(s)).find((f) => f.type === 'auth.refresh');
    expect(refreshSent).toEqual({ type: 'auth.refresh', token: renewedToken });
  });

  it('performs contiguous after_seq catch-up, gap recovery, resync_required, dedup, and ignores unknown frames', async () => {
    const { api, service } = setup({ platform: 'browser', mode: 'live' });
    await signInLive(api, makeJwt(Math.floor(Date.now() / 1000) + 600));

    // Bootstrap with legacy seq:null message + seq:1..3
    fakeFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        ticket: {
          id: TICKET_ID,
          reference: 'TKT-1',
          category: 'complaint',
          status: 'open',
          channel: 'chat',
          description: 'Help',
          booking_id: null,
          booking_ref: null,
          report_id: null,
          report_released_at: null,
          created_at: '2026-11-14T10:00:00.000Z',
          updated_at: '2026-11-14T10:05:00.000Z',
        },
        messages: [
          { id: 'legacy-0', sender: 'customer', body: 'Old msg', sent_at: '2026-11-14T09:50:00.000Z', seq: null },
          { id: 'm-1', sender: 'customer', body: 'First', sent_at: '2026-11-14T10:00:00.000Z', seq: 1 },
          { id: 'm-2', sender: 'support', body: 'Second', sent_at: '2026-11-14T10:01:00.000Z', seq: 2 },
          { id: 'm-3', sender: 'customer', body: 'Third', sent_at: '2026-11-14T10:02:00.000Z', seq: 3 },
        ],
        read_state: {
          ticket_id: TICKET_ID,
          last_seq: 3,
          customer_delivered_seq: 2,
          customer_read_seq: 2,
          staff_delivered_seq: 3,
          staff_read_seq: 3,
          customer_delivered_at: null,
          customer_read_at: null,
          staff_delivered_at: null,
          staff_read_at: null,
        },
        availability: { online: true, reason: 'online', next_open_at: null, opens_in_ist_text: null },
        unread_count: 0,
      }),
    });

    await service.loadChatBootstrap();
    expect(service.lastKnownSeq()).toBe(3);

    await service.connect(TICKET_ID);
    const ws = FakeWebSocket.instances[0];
    ws.emitOpen();
    const authOk = structuredClone(
      wsFixture.server_frames.find((f) => f.name === 'auth_ok_customer')!.frame,
    );
    (authOk as any).expires_at = new Date(Date.now() + 600_000).toISOString();
    ws.emitMessage(authOk);

    // Prepare multi-page catch-up when chat.joined says catch_up_required: true (has seq 4 then seq 5)
    fakeFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ticket_id: TICKET_ID,
          status: 'in_progress',
          messages: [
            { id: 'm-4', sender: 'support', body: 'Page 1 msg', sent_at: '2026-11-14T10:59:00.000Z', seq: 4 },
          ],
          read_state: null,
          has_more: true,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ticket_id: TICKET_ID,
          status: 'in_progress',
          messages: [
            wsFixture.server_frames.find((f) => f.name === 'chat_message_support')!.frame.message,
          ],
          read_state: wsFixture.server_frames.find((f) => f.name === 'chat_receipt')!.frame.read_state,
          has_more: false,
        }),
      });

    ws.emitMessage(wsFixture.server_frames.find((f) => f.name === 'chat_joined')!.frame);
    await vi.waitFor(() => expect(service.lastKnownSeq()).toBe(5));

    // Duplicate seq 5 frame is ignored
    const msgFrame = wsFixture.server_frames.find((f) => f.name === 'chat_message_support')!.frame;
    ws.emitMessage(msgFrame);
    expect(service.messages().filter((m) => m.seq === 5)).toHaveLength(1);

    // Unknown frame does not throw or corrupt state
    expect(() => ws.emitMessage({ type: 'unknown.future.frame', data: 123 })).not.toThrow();

    // Gap frame seq 7 triggers catch-up for seq 6 and merges seq 7 contiguously
    fakeFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        ticket_id: TICKET_ID,
        status: 'in_progress',
        messages: [
          { id: 'm-6', sender: 'customer', body: 'Filled gap', sent_at: '2026-11-14T11:01:00.000Z', seq: 6 },
        ],
        read_state: null,
        has_more: false,
      }),
    });

    ws.emitMessage({
      type: 'chat.message',
      ticket_id: TICKET_ID,
      message: { id: 'm-7', sender: 'support', body: 'Buffered future', sent_at: '2026-11-14T11:02:00.000Z', seq: 7 },
    });

    await vi.waitFor(() => expect(service.lastKnownSeq()).toBe(7));
    expect(service.messages().map((m) => m.seq)).toEqual([null, 1, 2, 3, 4, 5, 6, 7]);

    // resync_required triggers REST catch-up + unread + availability refresh
    const callsBeforeResync = fakeFetch.mock.calls.length;
    fakeFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ticket_id: TICKET_ID, status: 'in_progress', messages: [], read_state: null, has_more: false }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ total_unread: 1, chat_unread: 1 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ online: false, reason: 'outside_hours', next_open_at: null, opens_in_ist_text: 'Opens tomorrow at 9:00 AM IST' }),
      });

    ws.emitMessage(wsFixture.server_frames.find((f) => f.name === 'resync_required')!.frame);
    await vi.waitFor(() => expect(service.availability()?.online).toBe(false));
    expect(fakeFetch.mock.calls.length).toBeGreaterThanOrEqual(callsBeforeResync + 3);
  });

  it('first-send when no ticket exists creates and joins the new ticket, retains Idempotency-Key on retryable errors, and never stores chat text', async () => {
    const { api, service } = setup({ platform: 'browser', mode: 'live' });
    await signInLive(api, makeJwt(Math.floor(Date.now() / 1000) + 600));

    // Bootstrap with no open ticket
    fakeFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        ticket: null,
        messages: [],
        read_state: null,
        availability: { online: true, reason: 'online', next_open_at: null, opens_in_ist_text: null },
        unread_count: 0,
      }),
    });
    await service.loadChatBootstrap();
    expect(service.ticket()).toBeNull();

    // First attempt: network error; second attempt: 409 idempotency_in_progress; third: 201 Created
    fakeFetch
      .mockRejectedValueOnce(new Error('network drop'))
      .mockResolvedValueOnce({ ok: false, status: 409 })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          ticket: {
            id: TICKET_ID,
            reference: 'TKT-NEW',
            category: 'complaint',
            status: 'open',
            channel: 'chat',
            description: CANARY_BODY,
            booking_id: null,
            booking_ref: null,
            report_id: null,
            report_released_at: null,
            created_at: '2026-11-14T11:00:00.000Z',
            updated_at: '2026-11-14T11:00:00.000Z',
          },
          message: {
            id: 'msg-1',
            sender: 'customer',
            body: CANARY_BODY,
            sent_at: '2026-11-14T11:00:00.000Z',
            seq: 1,
          },
          read_state: {
            ticket_id: TICKET_ID,
            last_seq: 1,
            customer_delivered_seq: 0,
            customer_read_seq: 0,
            staff_delivered_seq: 0,
            staff_read_seq: 0,
            customer_delivered_at: null,
            customer_read_at: null,
            staff_delivered_at: null,
            staff_read_at: null,
          },
          availability: { online: true, reason: 'online', next_open_at: null, opens_in_ist_text: null },
          created: true,
        }),
      });

    expect(await service.sendChatMessage(CANARY_BODY)).toBeNull();
    expect(await service.sendChatMessage(CANARY_BODY)).toBeNull();
    const created = await service.sendChatMessage(CANARY_BODY);
    expect(created?.created).toBe(true);

    const postCalls = fakeFetch.mock.calls.filter(
      (c) => String(c[0]).endsWith('/support/chat') && c[1]?.method === 'POST',
    );
    expect(postCalls).toHaveLength(3);
    const key1 = postCalls[0][1].headers['Idempotency-Key'];
    const key2 = postCalls[1][1].headers['Idempotency-Key'];
    const key3 = postCalls[2][1].headers['Idempotency-Key'];
    expect(key1).toBeTruthy();
    expect(key2).toBe(key1);
    expect(key3).toBe(key1);

    // Joins the newly created ticket over WS
    expect(FakeWebSocket.instances).toHaveLength(1);
    const ws = FakeWebSocket.instances[0];
    ws.emitOpen();
    const authOk = structuredClone(
      wsFixture.server_frames.find((f) => f.name === 'auth_ok_customer')!.frame,
    );
    (authOk as any).expires_at = new Date(Date.now() + 600_000).toISOString();
    ws.emitMessage(authOk);
    expect(JSON.parse(ws.sent[1])).toEqual({
      type: 'chat.join',
      ticket_id: TICKET_ID,
      after_seq: 1,
    });

    // Storage privacy canary: chat body NEVER appears in localStorage or sessionStorage
    const allStorage = [
      ...Object.values(localStorage),
      ...Object.values(sessionStorage),
      ...Object.keys(localStorage),
      ...Object.keys(sessionStorage),
    ].join(' ');
    expect(allStorage).not.toContain(CANARY_BODY);
  });

  it('handles 4403 account_not_ready (one /me + one reconnect) and 4403 account_blocked stop, and ignores stale callbacks after sign-out', async () => {
    const { api, store, service } = setup({ platform: 'browser', mode: 'live' });
    await signInLive(api, makeJwt(Math.floor(Date.now() / 1000) + 600));

    await service.connect(TICKET_ID);
    const ws1 = FakeWebSocket.instances[0];
    ws1.emitOpen();

    // 4403 account_not_ready -> calls GET /v1/me once and reconnects once
    fakeFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 'u1' }) });
    ws1.emitMessage({ type: 'auth.error', code: 'account_not_ready', message: 'Not ready' });
    ws1.emitClose(4403, 'account_not_ready');

    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(2));
    expect(fakeFetch).toHaveBeenCalledWith(
      'https://api.example.invalid/v1/me',
      expect.objectContaining({ method: 'GET' }),
    );

    // Repeating account_not_ready stops without a third socket
    const ws2 = FakeWebSocket.instances[1];
    ws2.emitOpen();
    ws2.emitMessage({ type: 'auth.error', code: 'account_not_ready', message: 'Not ready' });
    ws2.emitClose(4403, 'account_not_ready');
    await Promise.resolve();
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(service.connectionState()).toBe('refused');

    // Sign out clears everything and sends 1000 on active socket; stale callback ignored
    await service.connect(TICKET_ID);
    const ws3 = FakeWebSocket.instances[2];
    ws3.emitOpen();
    const authOk3 = structuredClone(
      wsFixture.server_frames.find((f) => f.name === 'auth_ok_customer')!.frame,
    );
    (authOk3 as any).expires_at = new Date(Date.now() + 600_000).toISOString();
    ws3.emitMessage(authOk3);

    store.signOut();
    TestBed.tick();
    expect(ws3.closedWith[0]?.code).toBe(1000);
    expect(service.messages()).toEqual([]);
    expect(service.ticket()).toBeNull();

    // Stale frame on ws3 after sign-out is ignored
    ws3.emitMessage(wsFixture.server_frames.find((f) => f.name === 'chat_message_support')!.frame);
    expect(service.messages()).toEqual([]);

    // Re-sign-in and test 4403 account_blocked stops immediately without reconnect
    await signInLive(api, makeJwt(Math.floor(Date.now() / 1000) + 600));
    await service.connect(TICKET_ID);
    const ws4 = FakeWebSocket.instances[3];
    ws4.emitOpen();
    ws4.emitClose(4403, 'account_blocked');
    await Promise.resolve();
    expect(FakeWebSocket.instances).toHaveLength(4);
    expect(service.connectionState()).toBe('refused');
    expect(service.accountRefused()).toBe('account_blocked');
    expect(api.signedIn()).toBe(false);
  });
});
