import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { WebBanner } from '../core/models';
import { WebsiteStore } from '../core/store';
import { HomeBanners } from './home-banners';

const WEB = 'https://cdn.forumhospital.com/promos/banner-web.webp';
const make = (extra: Partial<WebBanner> = {}): WebBanner => ({
  id: 'promo-1',
  eyebrow: 'Offer',
  headline: 'A trained phlebotomist comes to you',
  body: 'Book a home collection.',
  cta_label: 'Browse tests',
  target_kind: 'tests',
  target_id: null,
  web_image_url: WEB,
  ...extra,
});

describe('Home banner strip', () => {
  const banners = signal<WebBanner[]>([]);
  function render() {
    const fixture = TestBed.createComponent(HomeBanners);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }
  beforeEach(() => {
    banners.set([]);
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: WebsiteStore, useValue: { banners } }],
    });
  });
  afterEach(() => TestBed.resetTestingModule());

  it('draws nothing when there are no banners', () => {
    expect(render().querySelector('section')).toBeNull();
    expect(render().textContent?.trim()).toBe('');
  });

  it('draws each banner with its words and a button to the right page', () => {
    banners.set([
      make(),
      make({ id: 'promo-2', headline: 'Heart check', target_kind: 'package', target_id: 'pkg-1' }),
    ]);
    const root = render();
    const cards = root.querySelectorAll('article');
    expect(cards).toHaveLength(2);
    expect(cards[0].querySelector('h2')?.textContent).toBe('A trained phlebotomist comes to you');
    expect(cards[0].querySelector('.banner-eyebrow')?.textContent).toBe('Offer');
    expect(cards[0].querySelector('.banner-body')?.textContent).toBe('Book a home collection.');
    expect(cards[0].querySelector('a')?.textContent?.trim()).toBe('Browse tests');
    expect(cards[0].querySelector('a')?.getAttribute('href')).toBe('/tests');
    expect(cards[1].querySelector('a')?.getAttribute('href')).toBe('/tests/pkg-1');
  });

  it('shows the website picture quietly: decorative, lazy, no referrer', () => {
    banners.set([make()]);
    const image = render().querySelector('img') as HTMLImageElement;
    expect(image.getAttribute('src')).toBe(WEB);
    expect(image.getAttribute('alt')).toBe('');
    expect(image.getAttribute('loading')).toBe('lazy');
    expect(image.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(render().querySelector('article')?.classList).toContain('with-picture');
  });

  it('draws a banner with no picture as text on the gradient, with no empty image', () => {
    banners.set([make({ web_image_url: null })]);
    const root = render();
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('article')?.classList).not.toContain('with-picture');
    expect(root.querySelector('h2')?.textContent).toContain('phlebotomist');
  });

  it('leaves out the button for a banner that has nowhere to go on the website', () => {
    banners.set([make({ target_kind: 'coupon' })]);
    expect(render().querySelector('a')).toBeNull();
  });

  it('leaves out an empty eyebrow and an empty body', () => {
    banners.set([make({ eyebrow: '', body: '' })]);
    const root = render();
    expect(root.querySelector('.banner-eyebrow')).toBeNull();
    expect(root.querySelector('.banner-body')).toBeNull();
  });
});
