import { TestBed } from '@angular/core/testing';
import { WebsiteApi } from './api';

describe('Website network boundaries', () => {
  let api: WebsiteApi;
  const fakeFetch = vi.fn();
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [WebsiteApi] });
    api = TestBed.inject(WebsiteApi);
    fakeFetch.mockReset();
    vi.stubGlobal('fetch', fakeFetch);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });
  function live() {
    api.config.set({
      mode: 'live',
      apiBaseUrl: 'https://api.example.invalid/v1',
      supabaseUrl: 'https://auth.example.invalid',
      publishableKey: 'sb_publishable_example',
    });
  }
  it('preview mode cannot accidentally call any backend', async () => {
    await expect(api.request('/orders', 'POST', {})).rejects.toMatchObject({ code: 'preview' });
    expect(fakeFetch).not.toHaveBeenCalled();
  });
  it('protected resources require authentication before any network request', async () => {
    live();
    await expect(api.request('/reports')).rejects.toMatchObject({ code: 'sign_in' });
    expect(fakeFetch).not.toHaveBeenCalled();
  });
  it('public catalog reads omit credentials and do not attach an auth token', async () => {
    live();
    fakeFetch.mockResolvedValue({ ok: true, status: 200, json: async () => [] });
    await api.request('/catalog/items', 'GET', undefined, undefined, false);
    expect(fakeFetch.mock.calls[0][0]).toBe('https://api.example.invalid/v1/catalog/items');
    const init = fakeFetch.mock.calls[0][1];
    expect(init.credentials).toBe('omit');
    expect(init.cache).toBe('no-store');
    expect(init.headers).not.toHaveProperty('Authorization');
  });
  it('does not expose raw error bodies containing private data', async () => {
    live();
    const body = vi.fn();
    fakeFetch.mockResolvedValue({ ok: false, status: 500, json: body });
    await expect(
      api.request('/catalog/items', 'GET', undefined, undefined, false),
    ).rejects.toMatchObject({ code: 'http_500' });
    expect(body).not.toHaveBeenCalled();
  });
  it('sanitizes network failures instead of displaying URLs or raw exceptions', async () => {
    live();
    fakeFetch.mockRejectedValue(new Error('SECRET query'));
    await expect(
      api.request('/catalog/items', 'GET', undefined, undefined, false),
    ).rejects.toMatchObject({ code: 'network' });
  });
  it('rejects an expired OAuth callback and erases its verifier and URL code', async () => {
    live();
    history.replaceState(null, '', '/auth/callback?code=expired-code');
    sessionStorage.setItem(
      'forum-web-pkce',
      JSON.stringify({ verifier: 'a'.repeat(43), expiresAt: 1 }),
    );
    await expect(api.finishSignIn()).rejects.toMatchObject({ code: 'sign_in' });
    expect(sessionStorage.getItem('forum-web-pkce')).toBeNull();
    expect(location.search).toBe('');
    expect(fakeFetch).not.toHaveBeenCalled();
    history.replaceState(null, '', '/');
  });
});
