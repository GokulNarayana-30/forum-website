import { TestBed } from '@angular/core/testing';
import { WebsiteApi, authCallbackPath, isAuthCallback } from './api';

describe('Website network boundaries', () => {
  let api: WebsiteApi;
  const fakeFetch = vi.fn();
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [WebsiteApi] });
    api = TestBed.inject(WebsiteApi);
    // Keep this suite independent of the owner's local live/preview configuration.
    api.config.set({ mode: 'preview', apiBaseUrl: '', supabaseUrl: '', publishableKey: '' });
    fakeFetch.mockReset();
    vi.stubGlobal('fetch', fakeFetch);
  });
  afterEach(() => {
    sessionStorage.clear();
    history.replaceState(null, '', '/');
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
  async function finishSignIn() {
    live();
    history.replaceState(null, '', '/auth/callback?code=test-code');
    sessionStorage.setItem(
      'forum-web-pkce',
      JSON.stringify({ verifier: 'a'.repeat(43), expiresAt: Date.now() + 60000 }),
    );
    fakeFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'test-access-token', expires_in: 3600 }),
    });
    await api.finishSignIn();
  }
  it('exchanges the callback code and uses the resulting token only on protected API calls', async () => {
    await finishSignIn();
    expect(fakeFetch.mock.calls[0][0]).toBe(
      'https://auth.example.invalid/auth/v1/token?grant_type=pkce',
    );
    const exchange = fakeFetch.mock.calls[0][1];
    expect(exchange.headers.apikey).toBe('sb_publishable_example');
    expect(JSON.parse(exchange.body)).toEqual({
      auth_code: 'test-code',
      code_verifier: 'a'.repeat(43),
    });
    expect(api.signedIn()).toBe(true);
    expect(sessionStorage.getItem('forum-web-pkce')).toBeNull();
    expect(location.search).toBe('');

    fakeFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'test-user' }) });
    await api.request('/me');
    expect(fakeFetch.mock.calls[1][0]).toBe('https://api.example.invalid/v1/me');
    expect(fakeFetch.mock.calls[1][1].headers.Authorization).toBe('Bearer test-access-token');

    await api.request('/catalog/items', 'GET', undefined, undefined, false);
    expect(fakeFetch.mock.calls[2][1].headers).not.toHaveProperty('Authorization');
  });
  it('clears a refused session and blocks further protected calls before the network', async () => {
    await finishSignIn();
    fakeFetch.mockResolvedValueOnce({ ok: false, status: 401 });
    await expect(api.request('/me')).rejects.toMatchObject({ code: 'sign_in' });
    expect(api.signedIn()).toBe(false);
    const calls = fakeFetch.mock.calls.length;
    await expect(api.request('/reports')).rejects.toMatchObject({ code: 'sign_in' });
    expect(fakeFetch).toHaveBeenCalledTimes(calls);
  });
});

describe('Sign-in return address', () => {
  it('is /auth/callback at a domain root', () => {
    expect(authCallbackPath('https://example.test/')).toBe('/auth/callback');
  });
  it('follows the base path when the site is served from a sub-path', () => {
    expect(authCallbackPath('https://gokulnarayana-30.github.io/forum-website/')).toBe(
      '/forum-website/auth/callback',
    );
  });
  it('recognises the callback page at the root and under a sub-path, and nothing else', () => {
    const pages = 'https://gokulnarayana-30.github.io/forum-website/';
    expect(isAuthCallback('/auth/callback', 'https://example.test/')).toBe(true);
    expect(isAuthCallback('/forum-website/auth/callback', pages)).toBe(true);
    // A root-style address is not the callback when the site lives under /forum-website/.
    expect(isAuthCallback('/auth/callback', pages)).toBe(false);
    expect(isAuthCallback('/forum-website/cart', pages)).toBe(false);
  });
});
