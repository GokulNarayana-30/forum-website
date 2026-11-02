import { afterNextRender, Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
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
  constructor() {
    afterNextRender(async () => {
      const callback = location.pathname === '/auth/callback';
      await this.store.initialize(callback);
      if (callback && this.store.signedIn() && this.store.ready())
        await this.router.navigateByUrl('/cart');
    });
  }
}
