import { createClient } from '@supabase/supabase-js';
import { env } from './env';

// Service-role client — bypasses RLS, used only on the backend
export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// Public/anon client — used for verifying user JWTs
export const supabaseAnon = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
