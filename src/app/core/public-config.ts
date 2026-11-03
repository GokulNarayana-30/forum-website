import { Config } from './models';

// Public browser configuration only. Never put a service key or database URL here.
// Live activation also requires API CORS and the Supabase callback allowlist.
export const publicConfig: Config = {
  mode: 'preview',
  apiBaseUrl: '',
  supabaseUrl: '',
  publishableKey: '',
};
