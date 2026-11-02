import { Component, inject, computed } from '@angular/core';
import { Meta } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { RouterLink, Router } from '@angular/router';
import { WebsiteStore } from '../core/store';
import { image, money, itemPrice } from '../core/models';
@Component({
  selector: 'forum-home',
  imports: [RouterLink, FormsModule],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home {
  constructor() {
    inject(Meta).updateTag({ name: 'robots', content: 'index,follow' });
  }
  protected searchQuery = '';
  private readonly router = inject(Router);
  protected search(): void {
    void this.router.navigate(['/tests'], { queryParams: { q: this.searchQuery.trim() || null } });
  }
  protected readonly store = inject(WebsiteStore);
  protected readonly featured = computed(() => this.store.items().slice(0, 4));
  protected readonly image = image;
  protected readonly money = money;
  protected readonly itemPrice = itemPrice;
}
