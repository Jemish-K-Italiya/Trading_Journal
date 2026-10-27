// Single place that reads the public Supabase settings.
// NEXT_PUBLIC_* values must be referenced as literal `process.env.NEXT_PUBLIC_X`
// expressions so Next.js can inline them into the browser bundle at build time.
export function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  // Accept the new publishable key or the legacy anon key (both are safe, public keys).
  const key = (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )?.trim();

  if (!url || !key || url.includes("YOUR_PROJECT") || key.includes("REPLACE_ME")) return null;
  return { url, key };
}

export const SUPABASE_CONFIG_ERROR =
  "Supabase is not configured. In Vercel, add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (Production, Preview and Development) and redeploy.";
