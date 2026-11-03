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
  async function finishSignIn(extra: object = {}) {
    live();
    history.replaceState(null, '', '/auth/callback?code=test-code');
    sessionStorage.setItem(
      'forum-web-pkce',
      JSON.stringify({ verifier: 'a'.repeat(43), expiresAt: Date.now() + 60000 }),
    );
    fakeFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'test-access-token', expires_in: 3600, ...extra }),
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
  // A page refresh drops everything held in memory; the session kept by the tab brings it back.
  function freshPage() {
    const page = new WebsiteApi();
    page.config.set({
      mode: 'live',
      apiBaseUrl: 'https://api.example.invalid/v1',
      supabaseUrl: 'https://auth.example.invalid',
      publishableKey: 'sb_publishable_example',
    });
    return page;
  }
  function keepSession(expiresAt: number, refresh = 'refresh-1') {
    sessionStorage.setItem(
      'forum-web-session',
      JSON.stringify({ access: 'old-access', refresh, expiresAt }),
    );
  }
  it('keeps the visitor signed in across a page refresh without calling the network', async () => {
    await finishSignIn({ refresh_token: 'refresh-1' });
    expect(fakeFetch).toHaveBeenCalledTimes(1);
    const page = freshPage();
    expect(await page.restoreSession()).toBe(true);
    expect(page.signedIn()).toBe(true);
    expect(fakeFetch).toHaveBeenCalledTimes(1);
    fakeFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'u' }) });
    await page.request('/me');
    expect(fakeFetch.mock.calls[1][1].headers.Authorization).toBe('Bearer test-access-token');
  });
  it('does not keep a session it could not renew later', async () => {
    await finishSignIn();
    expect(sessionStorage.getItem('forum-web-session')).toBeNull();
  });
  it('renews an expired kept session with its refresh token and stores the new one', async () => {
    live();
    keepSession(Date.now() - 1000);
    fakeFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'new-access',
        expires_in: 3600,
        refresh_token: 'refresh-2',
      }),
    });
    const page = freshPage();
    expect(await page.restoreSession()).toBe(true);
    expect(fakeFetch.mock.calls[0][0]).toBe(
      'https://auth.example.invalid/auth/v1/token?grant_type=refresh_token',
    );
    expect(JSON.parse(fakeFetch.mock.calls[0][1].body)).toEqual({ refresh_token: 'refresh-1' });
    expect(JSON.parse(sessionStorage.getItem('forum-web-session')!).refresh).toBe('refresh-2');
    fakeFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    await page.request('/me');
    expect(fakeFetch.mock.calls[1][1].headers.Authorization).toBe('Bearer new-access');
  });
  it('renews once when several protected calls start together, because the token is single-use', async () => {
    live();
    keepSession(Date.now() - 1000);
    const page = freshPage();
    fakeFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'new-access',
        expires_in: 3600,
        refresh_token: 'refresh-2',
      }),
    });
    fakeFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    await Promise.all([page.request('/me'), page.request('/reports'), page.request('/orders')]);
    const renewals = fakeFetch.mock.calls.filter((c) =>
      String(c[0]).includes('grant_type=refresh_token'),
    );
    expect(renewals).toHaveLength(1);
  });
  it('signs the visitor out and forgets the session when the refresh token is refused', async () => {
    live();
    keepSession(Date.now() - 1000);
    fakeFetch.mockResolvedValueOnce({ ok: false, status: 400 });
    const page = freshPage();
    expect(await page.restoreSession()).toBe(false);
    expect(page.signedIn()).toBe(false);
    expect(sessionStorage.getItem('forum-web-session')).toBeNull();
    await expect(page.request('/me')).rejects.toMatchObject({ code: 'sign_in' });
  });
  it('keeps the kept session when the renewal only failed because the network was down', async () => {
    live();
    keepSession(Date.now() - 1000);
    fakeFetch.mockRejectedValueOnce(new Error('offline'));
    const page = freshPage();
    expect(await page.restoreSession()).toBe(false);
    expect(sessionStorage.getItem('forum-web-session')).not.toBeNull();
  });
  it('ignores a damaged kept session instead of failing', async () => {
    live();
    sessionStorage.setItem('forum-web-session', '{not json');
    expect(await freshPage().restoreSession()).toBe(false);
    expect(sessionStorage.getItem('forum-web-session')).toBeNull();
    sessionStorage.setItem('forum-web-session', JSON.stringify({ access: 5 }));
    expect(await freshPage().restoreSession()).toBe(false);
    expect(sessionStorage.getItem('forum-web-session')).toBeNull();
    expect(fakeFetch).not.toHaveBeenCalled();
  });
  it('erases the kept session on sign-out', async () => {
    await finishSignIn({ refresh_token: 'refresh-1' });
    expect(sessionStorage.getItem('forum-web-session')).not.toBeNull();
    api.clearSession();
    expect(sessionStorage.getItem('forum-web-session')).toBeNull();
    expect(await freshPage().restoreSession()).toBe(false);
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
