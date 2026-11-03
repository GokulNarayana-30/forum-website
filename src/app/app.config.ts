import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideAppInitializer,
  inject,
} from '@angular/core';
import { provideRouter, TitleStrategy, withInMemoryScrolling } from '@angular/router';
import { WebsiteTitleStrategy } from './core/page-title';
import { routes } from './app.routes';
import { WebsiteStore } from './core/store';
import { provideClientHydration } from '@angular/platform-browser';

export const appConfig: ApplicationConfig = {
  providers: [
    { provide: TitleStrategy, useClass: WebsiteTitleStrategy },
    provideAppInitializer(() => inject(WebsiteStore).initialize()),
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      routes,
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled', anchorScrolling: 'enabled' }),
    ),
    provideClientHydration(),
  ],
};
