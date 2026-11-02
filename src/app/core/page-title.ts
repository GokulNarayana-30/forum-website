import { Injectable, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';

/** Resolved item data is available after navigation, including server rendering. */
@Injectable()
export class WebsiteTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);
  override updateTitle(snapshot: RouterStateSnapshot): void {
    let route = snapshot.root;
    while (route.firstChild) route = route.firstChild;
    const name = route.data['detail']?.item?.name;
    this.title.setTitle(
      name ? `${name} | Forum Labs` : (this.buildTitle(snapshot) ?? 'Forum Labs'),
    );
  }
}
