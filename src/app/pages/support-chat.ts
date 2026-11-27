import { isPlatformBrowser } from '@angular/common';
import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  PLATFORM_ID,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Meta } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { CustomerTicketMessage, CustomerTicketSummary, instant } from '../core/models';
import { WebsiteStore } from '../core/store';
import { SupportChatService } from '../core/support-chat.service';

@Component({
  selector: 'forum-support-chat',
  imports: [FormsModule, RouterLink],
  templateUrl: './support-chat.html',
  styleUrl: './support-chat.scss',
})
export class SupportChat {
  protected readonly store = inject(WebsiteStore);
  protected readonly chat = inject(SupportChatService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly meta = inject(Meta);

  protected readonly hydrated = signal(false);
  protected readonly loading = signal(false);
  protected readonly historyLoading = signal(false);
  protected readonly draft = signal('');
  protected readonly historyReply = signal('');
  protected readonly instant = instant;
  private readonly messagesLog = viewChild<ElementRef<HTMLElement>>('messagesLog');

  protected readonly isActiveClosed = computed(() => {
    const status = this.chat.ticket()?.status;
    return status === 'closed' || status === 'resolved';
  });

  protected readonly latestCustomerSeq = computed(() => {
    const msgs = this.chat.messages();
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.sender === 'customer' && typeof m.seq === 'number') {
        return m.seq;
      }
    }
    return null;
  });

  protected readonly deliveryStatusLabel = computed(() => {
    const seq = this.latestCustomerSeq();
    const rs = this.chat.readState();
    if (seq === null) return '';
    if (rs && rs.staff_read_seq >= seq) return 'Read';
    if (rs && rs.staff_delivered_seq >= seq) return 'Delivered';
    return 'Sent';
  });

  protected readonly canReplyHistory = computed(() => {
    const detail = this.chat.selectedHistoryDetail();
    if (!detail) return false;
    return !['resolved', 'closed'].includes(detail.ticket.status);
  });

  private activeSessionEpoch = 0;

  constructor() {
    this.meta.updateTag({ name: 'robots', content: 'noindex,nofollow' });

    afterNextRender(() => {
      if (!isPlatformBrowser(this.platformId)) return;
      this.hydrated.set(true);

      if (typeof document !== 'undefined' && typeof window !== 'undefined') {
        const syncVisibility = () => {
          const ticketId = this.chat.ticket()?.id ?? null;
          if (document.visibilityState === 'visible' && ticketId && this.chat.canConnectLive()) {
            this.chat.setThreadVisible(ticketId);
            void this.chat.refreshUnread();
          } else {
            this.chat.setThreadVisible(null);
          }
        };
        document.addEventListener('visibilitychange', syncVisibility);
        window.addEventListener('focus', syncVisibility);
        this.destroyRef.onDestroy(() => {
          document.removeEventListener('visibilitychange', syncVisibility);
          window.removeEventListener('focus', syncVisibility);
        });
      }
    });

    effect(() => {
      const hydrated = this.hydrated();
      const ready = this.store.ready();
      const preview = this.store.preview();
      const signed = this.store.signedIn();

      untracked(() => {
        if (!hydrated || !ready) return;
        const epoch = ++this.activeSessionEpoch;
        if (preview) {
          void this.chat.loadAvailability();
          return;
        }
        if (!signed) {
          this.chat.setThreadVisible(null);
          this.chat.disconnect(1000, 'normal_closure');
          void this.chat.loadAvailability();
          return;
        }
        void this.loadLiveChat(epoch);
      });
    });

    effect(() => {
      this.chat.messages();
      this.chat.staffTyping();
      const log = this.messagesLog()?.nativeElement;
      if (log && isPlatformBrowser(this.platformId)) {
        queueMicrotask(() => {
          log.scrollTop = log.scrollHeight;
        });
      }
    });

    this.destroyRef.onDestroy(() => {
      this.activeSessionEpoch++;
      this.chat.setThreadVisible(null);
      this.chat.disconnect(1000, 'normal_closure');
    });
  }

  private async loadLiveChat(epoch: number): Promise<void> {
    this.loading.set(true);
    try {
      const [bootstrap] = await Promise.all([
        this.chat.loadChatBootstrap(),
        this.chat.listMyTickets(),
        this.chat.refreshUnread(),
      ]);
      if (epoch !== this.activeSessionEpoch || !this.chat.canConnectLive()) return;
      if (bootstrap.ticket) {
        this.chat.setThreadVisible(bootstrap.ticket.id);
        await this.chat.connect(bootstrap.ticket.id);
      }
    } catch {
      /* Service signals surface errors safely without leaking raw details. */
    } finally {
      if (epoch === this.activeSessionEpoch) {
        this.loading.set(false);
      }
    }
  }

  protected onDraftInput(value: string): void {
    this.draft.set(value);
    const ticketId = this.chat.ticket()?.id;
    if (ticketId && value.trim().length > 0) {
      this.chat.sendTyping(ticketId, true);
    }
  }

  protected async sendLive(): Promise<void> {
    const body = this.draft().trim();
    if (!body || this.chat.sending()) return;
    const res = await this.chat.sendChatMessage(body);
    if (res) {
      this.draft.set('');
      this.chat.setThreadVisible(res.ticket.id);
      void this.chat.listMyTickets();
    }
  }

  protected async openTicket(ticket: CustomerTicketSummary): Promise<void> {
    this.historyLoading.set(true);
    this.historyReply.set('');
    try {
      await this.chat.loadTicketThread(ticket.id);
    } finally {
      this.historyLoading.set(false);
    }
  }

  protected async sendHistoryReply(): Promise<void> {
    const detail = this.chat.selectedHistoryDetail();
    const body = this.historyReply().trim();
    if (!detail || !body || !this.canReplyHistory() || this.chat.sending()) return;
    const msg = await this.chat.sendTicketMessage(detail.ticket.id, body);
    if (msg) {
      this.historyReply.set('');
    }
  }

  protected retryAccountNotReady(): void {
    this.chat.clearRefusal();
    if (this.chat.canConnectLive()) {
      void this.loadLiveChat(++this.activeSessionEpoch);
    }
  }

  protected statusText(status: string): string {
    return status.replaceAll('_', ' ');
  }

  protected startNewConversation(): void {
    this.draft.set('');
    this.chat.startNewConversation();
  }

  protected trackMessage(_index: number, item: CustomerTicketMessage): string {
    return item.id;
  }
}
