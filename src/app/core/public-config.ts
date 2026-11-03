import { Config } from './models';

// Public browser configuration only. Never put a service key or database URL here.
// Live activation also requires API CORS and the Supabase callback allowlist.
// mapsApiKey is a Google Maps browser key, public by design: restrict it in Google Cloud to this
// site's address (HTTP referrer) and to the Maps JavaScript API only. Empty keeps the map off.
export const publicConfig: Config = {
  mode: 'live',
  apiBaseUrl: 'https://forum-api-919146753011.asia-south1.run.app/v1',
  supabaseUrl: 'https://rmddjhblhefxilnqzunr.supabase.co',
  publishableKey: 'sb_publishable_322U01ZUg6pEPwuIsguuTw_cg8BYxC_',
  mapsApiKey: '',
};
