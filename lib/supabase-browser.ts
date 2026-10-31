"use client";

import { useMemo } from "react";
import { useAuth } from "@clerk/nextjs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// A browser Supabase client that acts as the signed-in person. Every request,
// and the Realtime websocket, carries their Clerk session token. Supabase
// verifies it (third-party auth) and RLS reads it as auth.jwt().
// Clerk tokens last about a minute; supabase-js asks for a fresh one each time.
export function useSupabase(): SupabaseClient | null {
  const { isLoaded, sessionId, getToken } = useAuth();
  return useMemo(() => {
    if (!isLoaded || !sessionId) return null;
    return createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      { accessToken: async () => (await getToken()) ?? null },
    );
  }, [isLoaded, sessionId, getToken]);
}
