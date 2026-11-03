import { RESPONSE_INIT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, ActivatedRouteSnapshot, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { routes } from '../app.routes';
import { WebsiteError } from '../core/api';
import { WebsiteStore } from '../core/store';
import { Journey } from './journey';

function create(view: string, init: ResponseInit | null) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: RESPONSE_INIT, useValue: init },
      { provide: ActivatedRoute, useValue: { data: of({ view }), queryParamMap: of(new Map()) } },
    ],
  });
  TestBed.createComponent(Journey);
}

describe('Server response status', () => {
  it('answers 404 for an address the site does not have', () => {
    const init: ResponseInit = { status: 200 };
    create('not-found', init);
    expect(init.status).toBe(404);
  });

  it('keeps 200 for a real page', () => {
    const init: ResponseInit = { status: 200 };
    create('cart', init);
    expect(init.status).toBe(200);
  });

  it('does nothing in the browser, where there is no response to change', () => {
    expect(() => create('not-found', null)).not.toThrow();
  });
});

describe('Server response status for a test page', () => {
  function resolveDetail(error: unknown, init: ResponseInit | null) {
    TestBed.configureTestingModule({
      providers: [
        { provide: RESPONSE_INIT, useValue: init },
        { provide: WebsiteStore, useValue: { detail: () => Promise.reject(error) } },
      ],
    });
    const route = routes.find((r) => r.path === 'tests/:id')!;
    const snapshot = {
      paramMap: { get: () => 'zzz-unknown' },
    } as unknown as ActivatedRouteSnapshot;
    return TestBed.runInInjectionContext(() =>
      (route.resolve!['detail'] as (r: ActivatedRouteSnapshot) => Promise<unknown>)(snapshot),
    );
  }

  it('answers 404 when the catalogue does not have the test (preview and live)', async () => {
    for (const code of ['not_found', 'http_404']) {
      TestBed.resetTestingModule();
      const init: ResponseInit = { status: 200 };
      expect(await resolveDetail(new WebsiteError(code), init)).toBeNull();
      expect(init.status).toBe(404);
    }
  });

  it('keeps 200 when the request merely failed, because the test may exist', async () => {
    for (const code of ['network', 'http_500', 'http_429']) {
      TestBed.resetTestingModule();
      const init: ResponseInit = { status: 200 };
      await resolveDetail(new WebsiteError(code), init);
      expect(init.status).toBe(200);
    }
  });
});
