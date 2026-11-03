import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { WebsiteStore } from '../core/store';
import { WebBanner, bannerLink } from '../core/models';

/** The banners made in the admin, shown under the Home hero with their website picture. */
@Component({
  selector: 'forum-home-banners',
  imports: [RouterLink],
  templateUrl: './home-banners.html',
  styleUrl: './home-banners.scss',
})
export class HomeBanners {
  protected readonly store = inject(WebsiteStore);
  protected link(banner: WebBanner) {
    return bannerLink(banner);
  }
}
