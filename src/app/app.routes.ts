import { inject, RESPONSE_INIT } from '@angular/core';
import { WebsiteError } from './core/api';
import { WebsiteStore } from './core/store';
import { Routes, ActivatedRouteSnapshot } from '@angular/router';
const journey = () => import('./pages/journey').then((m) => m.Journey);
export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/home').then((m) => m.Home),
    title: 'Forum Labs | Care that comes home',
  },
  {
    path: 'tests',
    loadComponent: journey,
    data: { view: 'tests' },
    title: 'Tests & packages | Forum Labs',
  },
  {
    path: 'tests/:id',
    resolve: {
      detail: (route: ActivatedRouteSnapshot) => {
        const response = inject(RESPONSE_INIT, { optional: true });
        return inject(WebsiteStore)
          .detail(route.paramMap.get('id') ?? '')
          .catch((error: unknown) => {
            // A test the catalogue does not have is a 404 for search engines. A failed request
            // (network, server error) is not: the test may exist, so the page keeps its status.
            const missing =
              error instanceof WebsiteError && ['not_found', 'http_404'].includes(error.code);
            if (missing && response) response.status = 404;
            return null;
          });
      },
    },
    loadComponent: journey,
    data: { view: 'detail' },
    title: 'Test details | Forum Labs',
  },
  { path: 'cart', loadComponent: journey, data: { view: 'cart' }, title: 'Your cart | Forum Labs' },
  {
    path: 'sign-in',
    loadComponent: journey,
    data: { view: 'sign-in' },
    title: 'Sign in | Forum Labs',
  },
  {
    path: 'auth/callback',
    loadComponent: journey,
    data: { view: 'callback' },
    title: 'Completing sign-in | Forum Labs',
  },
  {
    path: 'checkout',
    loadComponent: journey,
    data: { view: 'checkout' },
    title: 'Book home collection | Forum Labs',
  },
  {
    path: 'confirmation',
    loadComponent: journey,
    data: { view: 'confirmation' },
    title: 'Booking outcome | Forum Labs',
  },
  {
    path: 'bookings',
    loadComponent: journey,
    data: { view: 'bookings' },
    title: 'My bookings | Forum Labs',
  },
  {
    path: 'reports',
    loadComponent: journey,
    data: { view: 'reports' },
    title: 'My reports | Forum Labs',
  },
  {
    path: 'account',
    loadComponent: journey,
    data: { view: 'account' },
    title: 'My account | Forum Labs',
  },
  {
    path: 'privacy',
    loadComponent: journey,
    data: { view: 'privacy' },
    title: 'Privacy | Forum Labs',
  },
  { path: 'terms', loadComponent: journey, data: { view: 'terms' }, title: 'Terms | Forum Labs' },
  { path: 'help', loadComponent: journey, data: { view: 'help' }, title: 'Help | Forum Labs' },
  {
    path: '**',
    loadComponent: journey,
    data: { view: 'not-found' },
    title: 'Page not found | Forum Labs',
  },
];
