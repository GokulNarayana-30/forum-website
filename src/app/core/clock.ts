import { Injectable } from '@angular/core';
@Injectable({ providedIn: 'root' })
export class WebsiteClock {
  now(): number {
    return Date.now();
  }
  iso(): string {
    return new Date(this.now()).toISOString();
  }
}
