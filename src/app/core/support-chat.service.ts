import { isPlatformBrowser } from '@angular/common';
import { DestroyRef, Injectable, PLATFORM_ID, effect, inject, signal, untracked } from '@angular/core';
import { WebsiteApi, WebsiteError } from './api';
import {
  ChatReadState,
  CustomerChatBootstrap,
  CustomerChatMessageResult,
  CustomerTicketDetail,
  CustomerTicketMessage,
  CustomerTicketSummary,
  SupportAvailability,
  SupportUnreadSummary,
  TicketMessagesPage,
} from './models';
import { WebsiteStore } from './store';

export type ChatConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'refused';

const REFRESH_BEFORE_EXPIRY_MS = 45_000;
const PING_INTERVAL_MS = 25_000;
const BACKOFF_STEPS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];
const MAX_TIMEOUT_MS = 2_147_483_647;
const TYPING_THROTTLE_MS = 1_000;
const TYPING_DEFAULT_TTL_MS = 4_000;

const PREVIEW_AVAILABILITY: SupportAvailability = {
  online: false,
  reason: 'outside_hours',
  next_open_at: null,
  opens_in_ist_text: 'Preview mode — live support chat is unavailable in preview.',
};

function compareMessages(a: CustomerTicketMessage, b: CustomerTicketMessage): number {
  const seqA = typeof a.seq === 'number' ? a.seq : 0;
  const seqB = typeof b.seq === 'number' ? b.seq : 0;
  if (seqA !== seqB) return seqA - seqB;
  const timeA = Date.parse(a.sent_at);
  const timeB = Date.parse(b.sent_at);
  if (Number.isFinite(timeA) && Number.isFinite(timeB) && timeA !== timeB) {
    return timeA - timeB;
  }
  return a.id.localeCompare(b.id);
}

function mergeSortedMessages(
  existing: readonly CustomerTicketMessage[],
  incoming: readonly CustomerTicketMessage[],
): CustomerTicketMessage[] {
  const byId = new Map<string, CustomerTicketMessage>();
  for (const m of existing) byId.set(m.id, m);
  for (const m of incoming) byId.set(m.id, m);
  return Array.from(byId.values()).sort(compareMessages);
}

function isRetryableSendError(error: unknown): boolean {
  return (
    error instanceof WebsiteError &&
    (error.code === 'network' || error.code === 'http_408' || error.code === 'http_409')
  );
}

@Injectable({ providedIn: 'root' })
export class SupportChatService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly api = inject(WebsiteApi);
  private readonly store = inject(WebsiteStore);
  private readonly destroyRef = inject(DestroyRef);

  readonly availability = signal<SupportAvailability | null>(null);
  readonly ticket = signal<CustomerTicketSummary | null>(null);
  readonly messages = signal<CustomerTicketMessage[]>([]);
  readonly readState = signal<ChatReadState | null>(null);
  readonly unread = signal<SupportUnreadSummary>({ total_unread: 0, chat_unread: 0 });
  readonly tickets = signal<CustomerTicketSummary[]>([]);
  readonly selectedHistoryDetail = signal<CustomerTicketDetail | null>(null);
  readonly staffTyping = signal(false);
  readonly connectionState = signal<ChatConnectionState>('disconnected');
  readonly accountRefused = signal<string | null>(null);
  readonly lastKnownSeq = signal(0);
  readonly error = signal('');
  readonly sending = signal(false);

  private ws: WebSocket | null = null;
  private connectionEpoch = 0;
  private authorized = false;
  private activeTicketId: string | null = null;
  private joinedTicketId: string | null = null;
  private visibleTicketId: string | null = null;
  private hasConnectedOnce = false;
  private reconnectAttempt = 0;
  private accountNotReadyRetried = false;
  private lastAuthErrorCode: string | null = null;
  private catchingUp = false;
  private catchUpPending = false;
  private bufferedLiveMessages: CustomerTicketMessage[] = [];
  private pendingSend: { target: string; body: string; key: string } | null = null;
  private readonly lastAckedDelivered = new Map<string, number>();
  private readonly lastAckedRead = new Map<string, number>();
  private readonly lastTypingEmitAt = new Map<string, number>();

  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private typingExpiryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    let wasSignedIn = false;
    effect(() => {
      const signed = this.store.signedIn();
      if (wasSignedIn && !signed) {
        untracked(() => {
          this.disconnect(1000, 'normal_closure');
          this.clearChatState(false);
        });
      } else if (!wasSignedIn && signed) {
        untracked(() => {
          this.accountRefused.set(null);
          this.error.set('');
          if (this.connectionState() === 'refused') {
            this.connectionState.set('disconnected');
          }
        });
      }
      wasSignedIn = signed;
    });
    this.destroyRef.onDestroy(() => this.disconnect(1000, 'normal_closure'));
  }

  canConnectLive(): boolean {
    return (
      isPlatformBrowser(this.platformId) &&
      this.api.config().mode === 'live' &&
      this.store.signedIn()
    );
  }

  private canReadPublicLive(): boolean {
    return isPlatformBrowser(this.platformId) && this.api.config().mode === 'live';
  }

  clearRefusal(): void {
    this.accountRefused.set(null);
    this.error.set('');
    if (this.connectionState() === 'refused') {
      this.connectionState.set('disconnected');
    }
  }

  private clearChatState(clearRefusal = true): void {
    this.ticket.set(null);
    this.messages.set([]);
    this.readState.set(null);
    this.unread.set({ total_unread: 0, chat_unread: 0 });
    this.tickets.set([]);
    this.selectedHistoryDetail.set(null);
    this.staffTyping.set(false);
    this.lastKnownSeq.set(0);
    this.activeTicketId = null;
    this.joinedTicketId = null;
    this.visibleTicketId = null;
    this.bufferedLiveMessages = [];
    this.pendingSend = null;
    this.lastAckedDelivered.clear();
    this.lastAckedRead.clear();
    this.lastTypingEmitAt.clear();
    this.accountNotReadyRetried = false;
    this.lastAuthErrorCode = null;
    if (clearRefusal) {
      this.accountRefused.set(null);
      this.error.set('');
    }
  }

  async loadAvailability(): Promise<SupportAvailability> {
    if (this.api.config().mode === 'preview') {
      this.availability.set(PREVIEW_AVAILABILITY);
      return PREVIEW_AVAILABILITY;
    }
    if (!this.canReadPublicLive()) {
      return (
        this.availability() ?? {
          online: false,
          reason: 'outside_hours',
          next_open_at: null,
          opens_in_ist_text: null,
        }
      );
    }
    const res = await this.api.request<SupportAvailability>(
      '/support/availability',
      'GET',
      undefined,
      undefined,
      false,
    );
    this.availability.set(res);
    return res;
  }

  async loadChatBootstrap(): Promise<CustomerChatBootstrap> {
    if (this.api.config().mode === 'preview') {
      const empty: CustomerChatBootstrap = {
        ticket: null,
        messages: [],
        read_state: null,
        availability: PREVIEW_AVAILABILITY,
        unread_count: 0,
      };
      this.availability.set(PREVIEW_AVAILABILITY);
      return empty;
    }
    if (!this.canConnectLive()) {
      return {
        ticket: null,
        messages: [],
        read_state: null,
        availability:
          this.availability() ?? {
            online: false,
            reason: 'outside_hours',
            next_open_at: null,
            opens_in_ist_text: null,
          },
        unread_count: 0,
      };
    }

    const res = await this.api.request<CustomerChatBootstrap>('/support/chat');
    this.availability.set(res.availability);
    this.ticket.set(res.ticket);
    this.readState.set(res.read_state);
    this.activeTicketId = res.ticket?.id ?? null;

    const sorted = mergeSortedMessages([], res.messages ?? []);
    this.messages.set(sorted);
    this.recomputeContiguousSeq(sorted);

    if (res.ticket && res.read_state) {
      this.syncWatermarksFromState(res.ticket.id, res.read_state);
    }
    return res;
  }

  async sendChatMessage(body: string, key?: string): Promise<CustomerChatMessageResult | null> {
    if (!this.canConnectLive()) return null;
    const trimmed = body.trim();
    if (!trimmed || trimmed.length > 500) {
      this.error.set('Please enter a message between 1 and 500 characters.');
      return null;
    }

    const idempotencyKey =
      key ??
      (this.pendingSend?.target === 'chat' && this.pendingSend.body === trimmed
        ? this.pendingSend.key
        : `chat_${crypto.randomUUID().replaceAll('-', '')}`);

    if (!key) {
      this.pendingSend = { target: 'chat', body: trimmed, key: idempotencyKey };
    }

    this.sending.set(true);
    this.error.set('');
    try {
      const res = await this.api.request<CustomerChatMessageResult>(
        '/support/chat',
        'POST',
        { body: trimmed },
        idempotencyKey,
      );
      if (this.pendingSend?.key === idempotencyKey) {
        this.pendingSend = null;
      }
      const previousTicketId = this.activeTicketId;
      this.ticket.set(res.ticket);
      this.availability.set(res.availability);
      this.readState.set(res.read_state);
      this.activeTicketId = res.ticket.id;

      const merged = mergeSortedMessages(this.messages(), [res.message]);
      this.messages.set(merged);
      this.recomputeContiguousSeq(merged);
      this.syncWatermarksFromState(res.ticket.id, res.read_state);

      if (previousTicketId !== res.ticket.id || !this.ws || this.ws.readyState !== 1) {
        void this.connect(res.ticket.id);
      }
      return res;
    } catch (err) {
      if (!isRetryableSendError(err) && this.pendingSend?.key === idempotencyKey) {
        this.pendingSend = null;
      }
      this.error.set(
        err instanceof WebsiteError
          ? err.message
          : 'Could not send your message. Please try again.',
      );
      return null;
    } finally {
      this.sending.set(false);
    }
  }

  async listMyTickets(): Promise<CustomerTicketSummary[]> {
    if (!this.canConnectLive()) {
      this.tickets.set([]);
      return [];
    }
    const list = await this.api.request<CustomerTicketSummary[]>('/support/tickets');
    this.tickets.set(Array.isArray(list) ? list : []);
    return this.tickets();
  }

  async loadTicketThread(ticketId: string): Promise<CustomerTicketDetail | null> {
    if (!this.canConnectLive()) return null;
    const detail = await this.api.request<CustomerTicketDetail>(
      `/support/tickets/${encodeURIComponent(ticketId)}`,
    );
    const normalized: CustomerTicketDetail = {
      ticket: detail.ticket,
      messages: mergeSortedMessages([], detail.messages ?? []),
    };
    this.selectedHistoryDetail.set(normalized);
    return normalized;
  }

  async sendTicketMessage(
    ticketId: string,
    body: string,
    key?: string,
  ): Promise<CustomerTicketMessage | null> {
    if (!this.canConnectLive()) return null;
    const trimmed = body.trim();
    if (!trimmed || trimmed.length > 500) {
      this.error.set('Please enter a message between 1 and 500 characters.');
      return null;
    }

    const target = `ticket:${ticketId}`;
    const idempotencyKey =
      key ??
      (this.pendingSend?.target === target && this.pendingSend.body === trimmed
        ? this.pendingSend.key
        : `tkt_${crypto.randomUUID().replaceAll('-', '')}`);

    if (!key) {
      this.pendingSend = { target, body: trimmed, key: idempotencyKey };
    }

    this.sending.set(true);
    this.error.set('');
    try {
      const msg = await this.api.request<CustomerTicketMessage>(
        `/support/tickets/${encodeURIComponent(ticketId)}/messages`,
        'POST',
        { body: trimmed },
        idempotencyKey,
      );
      if (this.pendingSend?.key === idempotencyKey) {
        this.pendingSend = null;
      }
      const currentDetail = this.selectedHistoryDetail();
      if (currentDetail?.ticket.id === ticketId) {
        this.selectedHistoryDetail.set({
          ...currentDetail,
          messages: mergeSortedMessages(currentDetail.messages, [msg]),
        });
      }
      if (this.activeTicketId === ticketId) {
        const merged = mergeSortedMessages(this.messages(), [msg]);
        this.messages.set(merged);
        this.recomputeContiguousSeq(merged);
      }
      return msg;
    } catch (err) {
      if (!isRetryableSendError(err) && this.pendingSend?.key === idempotencyKey) {
        this.pendingSend = null;
      }
      this.error.set(
        err instanceof WebsiteError
          ? err.message
          : 'Could not send your reply. Please try again.',
      );
      return null;
    } finally {
      this.sending.set(false);
    }
  }

  async loadMessagesAfter(ticketId: string, afterSeq: number, limit = 50): Promise<TicketMessagesPage> {
    if (!this.canConnectLive()) {
      return { ticket_id: ticketId, status: 'open', messages: [], read_state: null, has_more: false };
    }
    const seq = Math.max(0, Math.floor(afterSeq));
    return this.api.request<TicketMessagesPage>(
      `/support/tickets/${encodeURIComponent(ticketId)}/messages?after_seq=${seq}&limit=${limit}`,
    );
  }

  async markRead(ticketId: string, seq: number): Promise<ChatReadState | null> {
    if (!this.canConnectLive() || !Number.isInteger(seq) || seq < 1) return null;
    const state = await this.api.request<ChatReadState>(
      `/support/tickets/${encodeURIComponent(ticketId)}/read`,
      'POST',
      { seq },
    );
    if (this.activeTicketId === ticketId) {
      this.readState.set(state);
    }
    this.syncWatermarksFromState(ticketId, state);
    void this.refreshUnread();
    return state;
  }

  async refreshUnread(): Promise<SupportUnreadSummary> {
    if (!this.canConnectLive()) {
      const zero = { total_unread: 0, chat_unread: 0 };
      this.unread.set(zero);
      return zero;
    }
    const summary = await this.api.request<SupportUnreadSummary>('/support/unread');
    this.unread.set(summary);
    return summary;
  }

  setThreadVisible(ticketId: string | null): void {
    this.visibleTicketId = ticketId;
    if (ticketId && ticketId === this.activeTicketId && this.isDocumentForeground()) {
      const maxSeq = this.highestSequencedMessage(this.messages());
      if (maxSeq > 0) {
        void this.ackRead(ticketId, maxSeq);
      }
    }
  }

  sendTyping(ticketId: string, isTyping: boolean): void {
    if (!this.canConnectLive() || !this.authorized || this.joinedTicketId !== ticketId) return;
    if (isTyping) {
      const now = Date.now();
      const prev = this.lastTypingEmitAt.get(ticketId) ?? 0;
      if (now - prev < TYPING_THROTTLE_MS) return;
      this.lastTypingEmitAt.set(ticketId, now);
    }
    this.sendFrame({ type: 'typing', ticket_id: ticketId, is_typing: isTyping });
  }

  async connect(ticketId?: string | null): Promise<void> {
    if (!this.canConnectLive()) return;
    if (ticketId !== undefined) {
      this.activeTicketId = ticketId ?? null;
    }

    if (this.ws && this.ws.readyState === 1 && this.authorized) {
      const target = this.activeTicketId;
      if (target && this.joinedTicketId !== target) {
        if (this.joinedTicketId) {
          this.sendFrame({ type: 'chat.leave', ticket_id: this.joinedTicketId });
        }
        this.joinedTicketId = target;
        this.sendFrame({ type: 'chat.join', ticket_id: target, after_seq: this.lastKnownSeq() });
      }
      return;
    }

    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) {
      return;
    }

    await this.openSocket();
  }

  disconnect(code = 1000, reason = 'normal_closure'): void {
    this.connectionEpoch++;
    this.clearTimers();
    this.authorized = false;
    this.joinedTicketId = null;
    const socket = this.ws;
    this.ws = null;
    if (socket && (socket.readyState === 0 || socket.readyState === 1)) {
      try {
        socket.close(code, reason);
      } catch {
        /* ignore close errors */
      }
    }
    if (this.connectionState() !== 'refused') {
      this.connectionState.set('disconnected');
    }
  }

  private async openSocket(): Promise<void> {
    this.clearReconnectTimer();
    if (!this.canConnectLive()) return;

    const epoch = ++this.connectionEpoch;
    this.authorized = false;
    this.joinedTicketId = null;
    this.lastAuthErrorCode = null;
    this.connectionState.set(this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting');

    const token = await this.api.accessToken();
    if (epoch !== this.connectionEpoch || !this.canConnectLive() || !token) {
      if (epoch === this.connectionEpoch) {
        this.connectionState.set('disconnected');
      }
      return;
    }

    if (typeof globalThis.WebSocket !== 'function') {
      this.connectionState.set('disconnected');
      return;
    }

    const ws = new globalThis.WebSocket(this.buildWsUrl());
    this.ws = ws;

    ws.addEventListener('open', () => {
      if (epoch !== this.connectionEpoch || this.ws !== ws || !this.canConnectLive()) return;
      this.sendFrame({ type: 'auth', token, mode: 'customer' });
    });

    ws.addEventListener('message', (event: MessageEvent) => {
      if (epoch !== this.connectionEpoch || this.ws !== ws || !this.canConnectLive()) return;
      this.handleRawMessage(event.data);
    });

    ws.addEventListener('close', (event: CloseEvent) => {
      if (epoch !== this.connectionEpoch || this.ws !== ws) return;
      this.ws = null;
      this.authorized = false;
      this.joinedTicketId = null;
      this.clearConnectionTimers();
      void this.handleClose(event.code, event.reason);
    });

    ws.addEventListener('error', () => {
      /* Close event drives backoff/refusal handling cleanly. */
    });
  }

  private buildWsUrl(): string {
    const u = new URL(this.api.config().apiBaseUrl);
    const wsProtocol = u.protocol === 'http:' ? 'ws:' : 'wss:';
    const basePath = u.pathname.replace(/\/$/, '');
    const apiPrefix = basePath || '/v1';
    return `${wsProtocol}//${u.host}${apiPrefix}/support/chat/ws`;
  }

  private sendFrame(frame: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== 1) return;
    this.ws.send(JSON.stringify(frame));
  }

  private handleRawMessage(raw: unknown): void {
    if (typeof raw !== 'string') return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
    const frame = parsed as Record<string, unknown>;
    const type = frame['type'];
    if (typeof type !== 'string') return;

    switch (type) {
      case 'auth.ok': {
        this.authorized = true;
        this.reconnectAttempt = 0;
        this.accountNotReadyRetried = false;
        this.connectionState.set('connected');
        if (this.isAvailability(frame['availability'])) {
          this.availability.set(frame['availability']);
        }
        const expiresAt = typeof frame['expires_at'] === 'string' ? Date.parse(frame['expires_at']) : 0;
        this.scheduleAuthRefresh(expiresAt);
        this.startPingTimer();

        const targetTicket = this.activeTicketId;
        const wasReconnect = this.hasConnectedOnce;
        this.hasConnectedOnce = true;

        if (targetTicket) {
          this.joinedTicketId = targetTicket;
          this.sendFrame({
            type: 'chat.join',
            ticket_id: targetTicket,
            after_seq: this.lastKnownSeq(),
          });
        }
        if (wasReconnect) {
          void this.resyncEverything(targetTicket);
        }
        return;
      }

      case 'auth.error': {
        if (typeof frame['code'] === 'string') {
          this.lastAuthErrorCode = frame['code'];
        }
        return;
      }

      case 'chat.joined': {
        const ticketId = typeof frame['ticket_id'] === 'string' ? frame['ticket_id'] : null;
        if (!ticketId || ticketId !== this.activeTicketId) return;
        const rs = frame['read_state'] as ChatReadState | undefined;
        if (rs && typeof rs.last_seq === 'number') {
          this.readState.set(rs);
          this.syncWatermarksFromState(ticketId, rs);
        }
        if (frame['catch_up_required'] === true || (rs && rs.last_seq > this.lastKnownSeq())) {
          void this.catchUpTicket(ticketId);
        }
        return;
      }

      case 'chat.message': {
        const ticketId = typeof frame['ticket_id'] === 'string' ? frame['ticket_id'] : null;
        const msg = frame['message'] as CustomerTicketMessage | undefined;
        if (!ticketId || !msg || typeof msg.id !== 'string' || typeof msg.body !== 'string') return;
        if (ticketId !== this.activeTicketId) {
          void this.refreshUnread();
          return;
        }
        this.handleIncomingMessage(ticketId, msg);
        return;
      }

      case 'chat.receipt': {
        const ticketId = typeof frame['ticket_id'] === 'string' ? frame['ticket_id'] : null;
        const rs = frame['read_state'] as ChatReadState | undefined;
        if (!ticketId || ticketId !== this.activeTicketId || !rs) return;
        this.readState.set(rs);
        this.syncWatermarksFromState(ticketId, rs);
        return;
      }

      case 'chat.typing': {
        const ticketId = typeof frame['ticket_id'] === 'string' ? frame['ticket_id'] : null;
        if (!ticketId || ticketId !== this.activeTicketId || frame['actor'] !== 'support') return;
        const isTyping = frame['is_typing'] === true;
        this.setStaffTyping(isTyping, typeof frame['expires_at'] === 'string' ? frame['expires_at'] : undefined);
        return;
      }

      case 'chat.availability': {
        if (this.isAvailability(frame['availability'])) {
          this.availability.set(frame['availability']);
        }
        return;
      }

      case 'resync_required': {
        void this.resyncEverything(this.activeTicketId);
        return;
      }

      case 'chat.error': {
        const code = typeof frame['code'] === 'string' ? frame['code'] : '';
        if (code === 'ticket_closed' && this.ticket()) {
          this.ticket.update((t) => (t ? { ...t, status: 'closed' } : null));
        }
        return;
      }

      case 'pong':
      case 'error':
      default:
        return;
    }
  }

  private handleIncomingMessage(ticketId: string, msg: CustomerTicketMessage): void {
    if (this.messages().some((m) => m.id === msg.id)) {
      return;
    }
    if (msg.sender === 'support') {
      this.setStaffTyping(false);
    }

    const msgSeq = typeof msg.seq === 'number' ? msg.seq : null;
    if (this.catchingUp || (msgSeq !== null && msgSeq > this.lastKnownSeq() + 1)) {
      if (!this.bufferedLiveMessages.some((m) => m.id === msg.id)) {
        this.bufferedLiveMessages.push(msg);
      }
      if (!this.catchingUp) {
        void this.catchUpTicket(ticketId);
      }
      return;
    }

    const merged = mergeSortedMessages(this.messages(), [msg]);
    this.messages.set(merged);
    if (msgSeq !== null && msgSeq === this.lastKnownSeq() + 1) {
      this.recomputeContiguousSeq(merged);
    }
    if (msgSeq !== null) {
      void this.ackDelivered(ticketId, msgSeq);
      if (this.visibleTicketId === ticketId && this.isDocumentForeground()) {
        void this.ackRead(ticketId, msgSeq);
      }
    }
  }

  private async catchUpTicket(ticketId: string): Promise<void> {
    if (!this.canConnectLive() || ticketId !== this.activeTicketId) return;
    if (this.catchingUp) {
      this.catchUpPending = true;
      return;
    }

    this.catchingUp = true;
    const epoch = this.connectionEpoch;
    try {
      let cursor = this.lastKnownSeq();
      let hasMore = true;

      while (hasMore) {
        const page = await this.loadMessagesAfter(ticketId, cursor);
        if (epoch !== this.connectionEpoch || ticketId !== this.activeTicketId) return;

        const pageMsgs = Array.isArray(page.messages) ? page.messages : [];
        if (pageMsgs.length > 0) {
          const merged = mergeSortedMessages(this.messages(), pageMsgs);
          this.messages.set(merged);
        }
        if (page.read_state) {
          this.readState.set(page.read_state);
          this.syncWatermarksFromState(ticketId, page.read_state);
        }

        const sequenced = pageMsgs.filter((m) => typeof m.seq === 'number' && m.seq > cursor);
        if (sequenced.length > 0) {
          cursor = sequenced[sequenced.length - 1].seq!;
          this.lastKnownSeq.set(Math.max(this.lastKnownSeq(), cursor));
        } else {
          hasMore = false;
        }
        if (!page.has_more) {
          hasMore = false;
        }
      }

      if (this.bufferedLiveMessages.length > 0) {
        const drained = this.bufferedLiveMessages;
        this.bufferedLiveMessages = [];
        const merged = mergeSortedMessages(this.messages(), drained);
        this.messages.set(merged);
        this.recomputeContiguousSeq(merged);
      }

      const maxSeq = this.lastKnownSeq();
      if (maxSeq > 0) {
        void this.ackDelivered(ticketId, maxSeq);
        if (this.visibleTicketId === ticketId && this.isDocumentForeground()) {
          void this.ackRead(ticketId, maxSeq);
        }
      }
    } catch {
      /* Retry on next reconnect or resync. */
    } finally {
      this.catchingUp = false;
      if (this.catchUpPending) {
        this.catchUpPending = false;
        if (ticketId === this.activeTicketId) {
          void this.catchUpTicket(ticketId);
        }
      }
    }
  }

  private async resyncEverything(ticketId: string | null): Promise<void> {
    if (!this.canConnectLive()) return;
    const jobs: Promise<unknown>[] = [];
    if (ticketId) {
      jobs.push(this.catchUpTicket(ticketId));
    }
    jobs.push(this.refreshUnread().catch(() => undefined));
    jobs.push(this.loadAvailability().catch(() => undefined));
    await Promise.all(jobs);
  }

  private async handleClose(code: number, reason: string): Promise<void> {
    if (code === 1000 || !this.canConnectLive()) {
      this.connectionState.set('disconnected');
      return;
    }

    if (code === 4403) {
      const refusal = reason || this.lastAuthErrorCode || 'forbidden';
      if (refusal === 'account_not_ready' && !this.accountNotReadyRetried) {
        this.accountNotReadyRetried = true;
        const epoch = this.connectionEpoch;
        try {
          await this.api.request('/me');
          if (epoch === this.connectionEpoch && this.canConnectLive()) {
            await this.openSocket();
          }
          return;
        } catch {
          /* Fall through to stopped state. */
        }
      }

      this.connectionState.set('refused');
      this.accountRefused.set(refusal);
      this.error.set(
        refusal === 'account_not_ready'
          ? 'Your account setup is still finishing. Please retry or sign in again.'
          : refusal === 'account_blocked' || refusal === 'account_closed'
            ? 'This account is no longer active for live chat. Please sign out or contact Forum Labs.'
            : 'Live chat is not available for this account.',
      );
      if (refusal === 'account_blocked' || refusal === 'account_closed' || refusal === 'user_mismatch') {
        this.clearChatState(false);
        this.api.clearSession();
      }
      return;
    }

    if (code === 4401) {
      const epoch = this.connectionEpoch;
      const renewed = await this.api.accessToken({ forceRefresh: true });
      if (epoch !== this.connectionEpoch || !renewed || !this.canConnectLive()) {
        this.connectionState.set('disconnected');
        return;
      }
    }

    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer();
    if (!this.canConnectLive()) return;
    const cap = BACKOFF_STEPS_MS[Math.min(this.reconnectAttempt, BACKOFF_STEPS_MS.length - 1)];
    this.reconnectAttempt++;
    const delayMs = Math.floor(Math.random() * cap);
    this.connectionState.set('reconnecting');
    const epoch = this.connectionEpoch;
    this.reconnectTimer = setTimeout(() => {
      if (epoch !== this.connectionEpoch || !this.canConnectLive()) return;
      void this.openSocket();
    }, delayMs);
  }

  private scheduleAuthRefresh(expiresAtMs: number): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= 0) return;

    const delayMs = Math.min(Math.max(0, expiresAtMs - Date.now() - REFRESH_BEFORE_EXPIRY_MS), MAX_TIMEOUT_MS);
    const epoch = this.connectionEpoch;
    this.refreshTimer = setTimeout(async () => {
      if (epoch !== this.connectionEpoch || !this.canConnectLive() || !this.ws) return;
      const renewed = await this.api.accessToken({ forceRefresh: true });
      if (epoch !== this.connectionEpoch || !this.canConnectLive() || !this.ws) return;
      if (!renewed) {
        this.disconnect(1000, 'normal_closure');
        return;
      }
      this.sendFrame({ type: 'auth.refresh', token: renewed });
    }, delayMs);
  }

  private startPingTimer(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
    }
    const epoch = this.connectionEpoch;
    this.pingTimer = setInterval(() => {
      if (epoch !== this.connectionEpoch || !this.authorized) return;
      this.sendFrame({ type: 'ping', ts: Date.now() });
    }, PING_INTERVAL_MS);
  }

  private setStaffTyping(active: boolean, expiresAtIso?: string): void {
    if (this.typingExpiryTimer) {
      clearTimeout(this.typingExpiryTimer);
      this.typingExpiryTimer = null;
    }
    this.staffTyping.set(active);
    if (active) {
      const parsedExp = expiresAtIso ? Date.parse(expiresAtIso) : NaN;
      const ttl = Number.isFinite(parsedExp)
        ? Math.max(500, Math.min(10_000, parsedExp - Date.now()))
        : TYPING_DEFAULT_TTL_MS;
      this.typingExpiryTimer = setTimeout(() => this.staffTyping.set(false), ttl);
    }
  }

  private async ackDelivered(ticketId: string, seq: number): Promise<void> {
    if (seq <= 0 || seq <= (this.lastAckedDelivered.get(ticketId) ?? 0)) return;
    this.lastAckedDelivered.set(ticketId, seq);
    if (this.authorized && this.joinedTicketId === ticketId) {
      this.sendFrame({ type: 'chat.delivered', ticket_id: ticketId, seq });
    }
  }

  private async ackRead(ticketId: string, seq: number): Promise<void> {
    if (seq <= 0 || seq <= (this.lastAckedRead.get(ticketId) ?? 0)) return;
    if (this.visibleTicketId !== ticketId || !this.isDocumentForeground()) return;
    this.lastAckedRead.set(ticketId, seq);
    this.lastAckedDelivered.set(ticketId, Math.max(this.lastAckedDelivered.get(ticketId) ?? 0, seq));
    if (this.authorized && this.joinedTicketId === ticketId) {
      this.sendFrame({ type: 'chat.read', ticket_id: ticketId, seq });
    } else {
      await this.markRead(ticketId, seq).catch(() => undefined);
    }
  }

  private syncWatermarksFromState(ticketId: string, rs: ChatReadState): void {
    if (rs.customer_delivered_seq > (this.lastAckedDelivered.get(ticketId) ?? 0)) {
      this.lastAckedDelivered.set(ticketId, rs.customer_delivered_seq);
    }
    if (rs.customer_read_seq > (this.lastAckedRead.get(ticketId) ?? 0)) {
      this.lastAckedRead.set(ticketId, rs.customer_read_seq);
    }
  }

  private recomputeContiguousSeq(list: readonly CustomerTicketMessage[]): void {
    let cursor = this.lastKnownSeq();
    const seqSet = new Set<number>();
    for (const m of list) {
      if (typeof m.seq === 'number' && m.seq >= 1) {
        seqSet.add(m.seq);
      }
    }
    while (seqSet.has(cursor + 1)) {
      cursor++;
    }
    this.lastKnownSeq.set(cursor);
  }

  private highestSequencedMessage(list: readonly CustomerTicketMessage[]): number {
    let max = 0;
    for (const m of list) {
      if (typeof m.seq === 'number' && m.seq > max) max = m.seq;
    }
    return max;
  }

  private isDocumentForeground(): boolean {
    return typeof document === 'undefined' || document.visibilityState !== 'hidden';
  }

  private isAvailability(value: unknown): value is SupportAvailability {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const v = value as Record<string, unknown>;
    return typeof v['online'] === 'boolean' && typeof v['reason'] === 'string';
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearConnectionTimers(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.typingExpiryTimer) {
      clearTimeout(this.typingExpiryTimer);
      this.typingExpiryTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearReconnectTimer();
    this.clearConnectionTimers();
  }
}
