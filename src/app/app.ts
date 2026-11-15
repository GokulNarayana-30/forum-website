import { isPlatformBrowser } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  inject,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet, NavigationEnd } from '@angular/router';
import { isAuthCallback } from './core/api';
import { WebsiteStore } from './core/store';
import { SupportChatService } from './core/support-chat.service';
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly store = inject(WebsiteStore);
  protected readonly chat = inject(SupportChatService);
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly menuOpen = signal(false);
  protected readonly currentPath = signal(this.router.url.split(/[?#]/)[0]);
  protected readonly showFloatingCart = computed(
    () => this.store.lines().length > 0 && !['/cart', '/checkout'].includes(this.currentPath()),
  );
  protected closeMenu(trigger?: HTMLButtonElement): void {
    if (!this.menuOpen()) return;
    this.menuOpen.set(false);
    trigger?.focus();
  }
  constructor() {
    this.router.events.pipe(takeUntilDestroyed()).subscribe((event) => {
      if (event instanceof NavigationEnd) {
        const path = event.urlAfterRedirects.split(/[?#]/)[0];
        this.currentPath.set(path);
        this.closeMenu();
        if (
          isPlatformBrowser(this.platformId) &&
          this.chat.canConnectLive() &&
          (path === '/help' || path === '/chat')
        ) {
          void this.chat.refreshUnread();
        }
      }
    });
    afterNextRender(async () => {
      const callback = isAuthCallback();
      await this.store.initialize(callback);
      if (callback && this.store.signedIn() && this.store.ready()) {
        const returnTo = this.store.consumeSignInReturn() ?? '/cart';
        if (this.store.needsDetails()) {
          // A new account adds its details first (the same as the app).
          this.store.message.set(
            'Welcome! Add your name and details to finish setting up your account.',
          );
          await this.router.navigateByUrl('/account');
        } else {
          await this.router.navigateByUrl(returnTo);
        }
      }
      if (this.chat.canConnectLive()) {
        void this.chat.refreshUnread();
      }
      if (typeof window !== 'undefined') {
        const onFocus = () => {
          const path = this.currentPath();
          if (this.chat.canConnectLive() && (path === '/help' || path === '/chat')) {
            void this.chat.refreshUnread();
          }
        };
        window.addEventListener('focus', onFocus);
        let helpTicks = 0;
        const helpRefreshTimer = setInterval(() => {
          if (this.currentPath() === '/help' && this.chat.canConnectLive() && helpTicks < 60) {
            helpTicks++;
            void this.chat.refreshUnread();
          }
        }, 30_000);
        this.destroyRef.onDestroy(() => {
          window.removeEventListener('focus', onFocus);
          clearInterval(helpRefreshTimer);
        });
      }
    });
  }
}
