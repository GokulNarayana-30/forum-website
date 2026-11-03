import { Config } from './models';

// Public browser configuration only. Never put a service key or database URL here.
// Live activation also requires API CORS and the Supabase callback allowlist.
export const publicConfig: Config = {
  mode: 'live',
  apiBaseUrl: 'https://forum-api-919146753011.asia-south1.run.app/v1',
  supabaseUrl: 'https://rmddjhblhefxilnqzunr.supabase.co',
  publishableKey: 'sb_publishable_322U01ZUg6pEPwuIsguuTw_cg8BYxC_',
};
