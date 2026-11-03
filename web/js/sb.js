import { createClient } from '../vendor/supabase.js';

const cfg = window.SIGNAGE_CONFIG || {};
export const configured = cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes('YOUR-PROJECT');

export function makeClient(storageKey) {
  return createClient(cfg.SUPABASE_URL || 'http://localhost', cfg.SUPABASE_ANON_KEY || 'x', {
    auth: { persistSession: true, autoRefreshToken: true, storageKey, detectSessionInUrl: true, flowType: 'pkce' },
    realtime: { params: { eventsPerSecond: 5 } },
  });
}

export const BUCKET = 'media';
