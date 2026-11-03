import { RESPONSE_INIT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, expect, it } from 'vitest';
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
