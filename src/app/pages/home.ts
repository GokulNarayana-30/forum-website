import { Component, inject, computed } from '@angular/core';
import { Meta } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { RouterLink, Router } from '@angular/router';
import { WebsiteStore } from '../core/store';
import { Item, image, itemImage, money, itemPrice } from '../core/models';
import { HomeBanners } from './home-banners';
@Component({
  selector: 'forum-home',
  imports: [RouterLink, FormsModule, HomeBanners],
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
  protected readonly itemImage = itemImage;
  protected readonly money = money;
  protected readonly itemPrice = itemPrice;
  protected inCart(itemId: string): boolean {
    return this.store.lines().some((line) => line.item_id === itemId && line.person_id === 'me');
  }
  protected addToCart(item: Item): void {
    void this.store.add(item);
  }
}
