import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseMisconfigured = !supabaseUrl || !supabaseAnonKey

// Create client even with placeholder values to avoid crashing at module level.
// If misconfigured, auth operations fail gracefully and the UI shows a config error.
export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-key',
)

// Export the anon key so edge function calls can bypass JWT verification
export { supabaseAnonKey }
