import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { afterNextRender, Component, inject, signal, computed } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet, NavigationEnd } from '@angular/router';
import { WebsiteStore } from './core/store';
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly store = inject(WebsiteStore);
  private readonly router = inject(Router);
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
        this.currentPath.set(event.urlAfterRedirects.split(/[?#]/)[0]);
        this.closeMenu();
      }
    });
    afterNextRender(async () => {
      const callback = location.pathname === '/auth/callback';
      await this.store.initialize(callback);
      if (callback && this.store.signedIn() && this.store.ready())
        await this.router.navigateByUrl('/cart');
    });
  }
}
