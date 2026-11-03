import { Injectable, signal } from '@angular/core';
import { Config } from './models';
import { publicConfig } from './public-config';

export class WebsiteError extends Error {
  constructor(
    public code: string,
    message = 'We could not complete that request. Please try again.',
  ) {
    super(message);
  }
}
/**
 * Where Google sends the visitor back to. It follows the page's <base href>, so it is
 * /auth/callback at a domain root and /forum-website/auth/callback on GitHub Pages.
 */
export function authCallbackPath(
  baseUri: string = document.querySelector('base')?.href ?? location.origin + '/',
): string {
  return new URL('auth/callback', baseUri).pathname;
}
@Injectable({ providedIn: 'root' })
export class WebsiteApi {
  readonly config = signal<Config>(publicConfig);
  readonly signedIn = signal(false);
  private token: string | null = null;
  private expiresAt = 0;
  async configure(): Promise<void> {
    const c = publicConfig;
    if (!['preview', 'live'].includes(c.mode)) throw new WebsiteError('configuration');
    if (c.mode === 'live') {
      for (const value of [c.apiBaseUrl, c.supabaseUrl]) {
        const u = new URL(value);
        if (
          u.protocol !== 'https:' &&
          !(u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname))
        )
          throw new WebsiteError('configuration');
        if (u.username || u.password || u.search || u.hash) throw new WebsiteError('configuration');
      }
      if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(c.publishableKey))
        throw new WebsiteError('configuration');
    }
    this.config.set(c);
  }
  async request<T>(
    path: string,
    method = 'GET',
    body?: unknown,
    key?: string,
    authenticated = true,
  ): Promise<T> {
    if (this.config().mode !== 'live') throw new WebsiteError('preview');
    if (authenticated && (!this.token || Date.now() >= this.expiresAt)) {
      this.clearSession();
      throw new WebsiteError('sign_in', 'Please sign in again to continue.');
    }
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (authenticated) headers['Authorization'] = `Bearer ${this.token}`;
    if (key) headers['Idempotency-Key'] = key;
    let r: Response;
    try {
      r = await fetch(this.config().apiBaseUrl.replace(/\/$/, '') + path, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
        headers,
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new WebsiteError(
        'network',
        'Connection interrupted. Your booking may still be processing. Retry the same request to check safely.',
      );
    }
    if (r.status === 401) {
      this.clearSession();
      throw new WebsiteError('sign_in', 'Please sign in again to continue.');
    }
    if (!r.ok)
      throw new WebsiteError(
        `http_${r.status}`,
        r.status === 429
          ? 'Too many requests. Please wait before trying again.'
          : 'The request was not accepted. Check your details or try again.',
      );
    if (r.status === 204) return undefined as T;
    try {
      return (await r.json()) as T;
    } catch {
      throw new WebsiteError('response');
    }
  }
  async signIn(): Promise<void> {
    const cfg = this.config();
    if (cfg.mode !== 'live') throw new WebsiteError('preview');
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const encode = (b: Uint8Array) =>
      btoa(String.fromCharCode(...b))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    const verifier = encode(bytes);
    const challenge = encode(
      new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))),
    );
    sessionStorage.setItem(
      'forum-web-pkce',
      JSON.stringify({ verifier, expiresAt: Date.now() + 600000 }),
    );
    const u = new URL(cfg.supabaseUrl + '/auth/v1/authorize');
    u.search = new URLSearchParams({
      provider: 'google',
      redirect_to: location.origin + authCallbackPath(),
      code_challenge: challenge,
      code_challenge_method: 's256',
    }).toString();
    location.assign(u.toString());
  }
  async finishSignIn(): Promise<void> {
    const url = new URL(location.href);
    const code = url.searchParams.get('code');
    // Supabase reports provider problems in the query or the hash (never contains tokens in these fields).
    const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
    const providerError =
      url.searchParams.get('error_description') ?? hash.get('error_description');
    history.replaceState(null, '', authCallbackPath());
    let stored: { verifier?: string; expiresAt?: number } = {};
    try {
      stored = JSON.parse(sessionStorage.getItem('forum-web-pkce') ?? '{}');
    } catch {
      /* fail closed */
    }
    sessionStorage.removeItem('forum-web-pkce');
    const fail = (reason: string, message: string): never => {
      console.warn('[forum-web] sign-in stopped:', reason);
      throw new WebsiteError('sign_in', message);
    };
    if (providerError)
      fail('provider_error', 'Google sign-in was refused: ' + providerError.slice(0, 160));
    if (!code)
      fail(
        'no_code',
        'Sign-in did not return a code. Check the Supabase redirect URL list, then start again.',
      );
    if (url.pathname !== authCallbackPath())
      fail('wrong_path', 'Sign-in expired. Please start again.');
    if (!/^[\w-]{43,128}$/.test(stored.verifier ?? ''))
      fail(
        'no_verifier',
        'Sign-in started in a different browser tab or address (use the same address, such as 127.0.0.1, for the whole sign-in). Please start again.',
      );
    if (!(stored.expiresAt! > Date.now()))
      fail('verifier_expired', 'Sign-in expired. Please start again.');
    const c = this.config();
    const r = await fetch(c.supabaseUrl + '/auth/v1/token?grant_type=pkce', {
      method: 'POST',
      headers: { apikey: c.publishableKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ auth_code: code, code_verifier: stored.verifier }),
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
    if (!r.ok)
      throw new WebsiteError('sign_in', 'Sign-in could not be completed. Please try again.');
    const data = (await r.json()) as { access_token: string; expires_in: number };
    if (typeof data.access_token !== 'string' || !Number.isFinite(data.expires_in))
      throw new WebsiteError('sign_in');
    this.token = data.access_token;
    this.expiresAt = Date.now() + data.expires_in * 1000;
    this.signedIn.set(true);
  }
  clearSession(): void {
    this.token = null;
    this.expiresAt = 0;
    this.signedIn.set(false);
  }
}
