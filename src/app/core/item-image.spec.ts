import { describe, expect, it } from 'vitest';
import { Item, itemImage } from './models';

const item = (over: Partial<Item>): Item => ({ id: 't-x', ...over }) as Item;

describe('itemImage', () => {
  it('uses the API picture first', () => {
    expect(itemImage(item({ id: 't-24-hour-urinary-protien', image_url: 'https://x/y.webp' }))).toBe(
      'https://x/y.webp',
    );
  });
  it("uses a test's own bundled picture", () => {
    expect(itemImage(item({ id: 't-24-hour-urinary-protien' }))).toBe(
      'assets/tests/24-hour-urinary-protien.webp',
    );
  });
  it('falls back to its category picture, then the collection banner', () => {
    expect(itemImage(item({ id: 't-no-such-test', category_ids: ['cat-heart'] }))).toBe(
      'assets/cat_heart.webp',
    );
    expect(itemImage(item({ id: 't-no-such-test', category_ids: ['cat-unknown'] }))).toBe(
      'assets/banner_home_collection.webp',
    );
  });
});
