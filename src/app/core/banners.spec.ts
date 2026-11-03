import { bannerLink, readBanners } from './models';

const WEB = 'https://cdn.forumhospital.com/promos/banner-web.webp';
const banner = (extra: Record<string, unknown> = {}) => ({
  id: 'promo-1',
  eyebrow: 'Offer',
  headline: 'A trained phlebotomist comes to you',
  body: 'Book a home collection.',
  cta_label: 'Browse tests',
  target: { kind: 'tests', target_id: null, item: null },
  prices_paise: [],
  image_url: 'https://cdn.forumhospital.com/promos/app.webp',
  web_image_url: WEB,
  ...extra,
});

describe('Home banners the website can draw', () => {
  it('keeps the text and only the website picture, never the app picture', () => {
    const [kept] = readBanners([banner()]);
    expect(kept).toEqual({
      id: 'promo-1',
      eyebrow: 'Offer',
      headline: 'A trained phlebotomist comes to you',
      body: 'Book a home collection.',
      cta_label: 'Browse tests',
      target_kind: 'tests',
      target_id: null,
      web_image_url: WEB,
    });
    expect(JSON.stringify(kept)).not.toContain('app.webp');
  });

  it('has no picture when none was set, and does not fall back to the tall app picture', () => {
    expect(readBanners([banner({ web_image_url: null })])[0].web_image_url).toBeNull();
    const { web_image_url: _omitted, ...fallbackBanner } = banner();
    expect(readBanners([fallbackBanner])[0].web_image_url).toBeNull();
  });

  it.each([
    ['plain http', 'http://cdn.forumhospital.com/w.webp'],
    ['a script address', 'javascript:alert(1)'],
    ['inline data', 'data:image/png;base64,AAAA'],
    ['a relative path', '/assets/w.webp'],
    ['spaces inside', 'https://cdn.forumhospital.com/a b.webp'],
    ['not a string', 42],
  ])('draws no picture for an address that is %s', (_why, value) => {
    expect(readBanners([banner({ web_image_url: value })])[0].web_image_url).toBeNull();
  });

  it('skips banners it cannot draw and keeps the rest in order', () => {
    const list = readBanners([
      banner({ id: 'a' }),
      banner({ id: 'no-headline', headline: '' }),
      banner({ id: 'blank-headline', headline: '   ' }),
      { ...banner({ id: 'no-cta' }), cta_label: undefined },
      { ...banner({ id: 'no-target' }), target: undefined },
      null,
      'nonsense',
      banner({ id: 'b' }),
    ]);
    expect(list.map((b) => b.id)).toEqual(['a', 'b']);
  });

  it('answers an empty list for anything that is not a list', () => {
    expect(readBanners(undefined)).toEqual([]);
    expect(readBanners(null)).toEqual([]);
    expect(readBanners({ banners: [] })).toEqual([]);
  });

  it('shows at most five banners', () => {
    const many = Array.from({ length: 9 }, (_, i) => banner({ id: 'p' + i }));
    expect(readBanners(many)).toHaveLength(5);
  });
});

describe('Where a banner button goes', () => {
  it.each([
    ['item', 'pkg-1', ['/tests', 'pkg-1'], {}],
    ['package', 'pkg-2', ['/tests', 'pkg-2'], {}],
    ['category', 'cat-heart', ['/tests'], { category: 'cat-heart' }],
    ['tests', null, ['/tests'], {}],
    ['home', null, ['/'], {}],
    ['support', null, ['/help'], {}],
    ['bookings', null, ['/bookings'], {}],
    ['reports_list', null, ['/reports'], {}],
  ])('opens the right page for %s', (kind, id, commands, query) => {
    expect(bannerLink({ target_kind: kind, target_id: id })).toEqual({ commands, query });
  });

  it.each([
    ['coupon', null],
    ['none', null],
    ['something_new', null],
    ['item', null],
    ['category', null],
  ])('shows no button when %s has nowhere to go', (kind, id) => {
    expect(bannerLink({ target_kind: kind, target_id: id })).toBeNull();
  });
});
