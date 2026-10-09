import { createClient } from "@supabase/supabase-js";
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined;
export const supabaseConfigured = Boolean(
  url &&
  /^https?:\/\//.test(url) &&
  key &&
  !url.includes("YOUR_PROJECT") &&
  !key.includes("YOUR_"),
);
export const supabase = createClient(
  supabaseConfigured ? url! : "https://placeholder.supabase.co",
  supabaseConfigured ? key! : "placeholder",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);
