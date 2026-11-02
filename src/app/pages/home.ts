import { Component, inject, computed } from '@angular/core';
import { Meta } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { WebsiteStore } from '../core/store';
import { image, money, itemPrice } from '../core/models';
@Component({
  selector: 'forum-home',
  imports: [RouterLink],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home {
  constructor() {
    inject(Meta).updateTag({ name: 'robots', content: 'index,follow' });
  }
  protected readonly store = inject(WebsiteStore);
  protected readonly featured = computed(() => this.store.items().slice(0, 4));
  protected readonly image = image;
  protected readonly money = money;
  protected readonly itemPrice = itemPrice;
}
