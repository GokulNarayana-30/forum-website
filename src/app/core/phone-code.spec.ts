import { TestBed } from '@angular/core/testing';
import { WebsiteApi, phoneErrorMessage } from './api';
import { indianMobile } from '../pages/phone-code';

describe('mobile number and code (2026-11-15)', () => {
  describe('indianMobile', () => {
    it.each([
      ['9876543210', '+919876543210'],
      ['+91 98765 43210', '+919876543210'],
      ['919876543210', '+919876543210'],
      ['09876543210', '+919876543210'],
    ])('%s -> %s', (typed, e164) => expect(indianMobile(typed)).toBe(e164));
    it.each(['12345', '5876543210', '+1 415 555 0100', ''])('refuses %s', (typed) =>
      expect(indianMobile(typed)).toBeNull(),
    );
  });

  describe('phoneErrorMessage', () => {
    it('a number on another account says so', () =>
      expect(phoneErrorMessage('phone_exists', 422)).toContain('already used by another account'));
    it('a wrong or expired code says so', () => {
      expect(phoneErrorMessage('otp_expired', 403)).toContain('didn’t match or has expired');
      expect(phoneErrorMessage('invalid_credentials', 400)).toContain('didn’t match');
    });
    it('too many codes asks to wait', () => {
      expect(phoneErrorMessage('over_sms_send_rate_limit', 429)).toContain('wait a minute');
      expect(phoneErrorMessage('unknown', 429)).toContain('wait a minute');
    });
    it('never repeats the server text', () =>
      expect(phoneErrorMessage('weird_code', 500)).not.toContain('weird'));
  });

  describe('Supabase calls', () => {
    let api: WebsiteApi;
    const fakeFetch = vi.fn();
    const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
    beforeEach(() => {
      TestBed.configureTestingModule({ providers: [WebsiteApi] });
      api = TestBed.inject(WebsiteApi);
      api.config.set({
        mode: 'live',
        apiBaseUrl: 'https://api.example.invalid/v1',
        supabaseUrl: 'https://auth.example.invalid',
        publishableKey: 'sb_publishable_example',
      });
      fakeFetch.mockReset();
      vi.stubGlobal('fetch', fakeFetch);
    });
    afterEach(() => {
      sessionStorage.clear();
      vi.unstubAllGlobals();
      TestBed.resetTestingModule();
    });

    it('preview mode sends no code', async () => {
      api.config.set({ mode: 'preview', apiBaseUrl: '', supabaseUrl: '', publishableKey: '' });
      await expect(api.sendPhoneOtp('+919876543210')).rejects.toMatchObject({ code: 'preview' });
      expect(fakeFetch).not.toHaveBeenCalled();
    });

    it('sign-in: asks Supabase for a code, then a right code signs the visitor in', async () => {
      fakeFetch.mockResolvedValueOnce(okJson({}));
      await api.sendPhoneOtp('+919876543210');
      const [url, init] = fakeFetch.mock.calls[0]!;
      expect(url).toBe('https://auth.example.invalid/auth/v1/otp');
      expect(JSON.parse(init.body)).toEqual({ phone: '+919876543210' });
      expect(init.headers.apikey).toBe('sb_publishable_example');
      expect(init.headers.Authorization).toBeUndefined();

      fakeFetch.mockResolvedValueOnce(
        okJson({ access_token: 'tok', expires_in: 3600, refresh_token: 'ref' }),
      );
      await api.verifyPhoneOtp('+919876543210', '123456');
      const [vurl, vinit] = fakeFetch.mock.calls[1]!;
      expect(vurl).toBe('https://auth.example.invalid/auth/v1/verify');
      expect(JSON.parse(vinit.body)).toEqual({
        type: 'sms',
        phone: '+919876543210',
        token: '123456',
      });
      expect(api.signedIn()).toBe(true);
    });

    it('a wrong code is a plain message and does not sign in', async () => {
      fakeFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ error_code: 'otp_expired', msg: 'Token has expired or is invalid' }),
      });
      await expect(api.verifyPhoneOtp('+919876543210', '000000')).rejects.toMatchObject({
        code: 'otp_expired',
      });
      expect(api.signedIn()).toBe(false);
    });

    it('verifying the number of a signed-out visitor never calls Supabase', async () => {
      await expect(api.requestPhoneChange('+919876543210')).rejects.toMatchObject({
        code: 'sign_in',
      });
      expect(fakeFetch).not.toHaveBeenCalled();
    });

    it('verifying the number of a signed-in account sends its session and a phone change', async () => {
      fakeFetch.mockResolvedValueOnce(
        okJson({ access_token: 'tok', expires_in: 3600, refresh_token: 'ref' }),
      );
      await api.verifyPhoneOtp('+919000000001', '123456');

      fakeFetch.mockResolvedValueOnce(okJson({}));
      await api.requestPhoneChange('+919876543210');
      const [url, init] = fakeFetch.mock.calls[1]!;
      expect(url).toBe('https://auth.example.invalid/auth/v1/user');
      expect(init.method).toBe('PUT');
      expect(init.headers.Authorization).toBe('Bearer tok');

      fakeFetch.mockResolvedValueOnce(okJson({}));
      await api.verifyPhoneChange('+919876543210', '654321');
      expect(JSON.parse(fakeFetch.mock.calls[2]![1].body)).toEqual({
        type: 'phone_change',
        phone: '+919876543210',
        token: '654321',
      });
    });
  });
});
