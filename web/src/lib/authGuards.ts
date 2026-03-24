import { supabaseBrowser } from "@/lib/supabaseBrowser";

export type ProfileRole = "ship" | "shore" | "ship,shore" | string;

export type AuthProfile = {
  id: string;
  role: ProfileRole | null;
  vessel_id: string | null;
  full_name: string | null;
};

export function parseRoles(role: string | null | undefined) {
  return new Set(
    String(role || "")
      .toLowerCase()
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
  );
}

export async function getCurrentProfile(): Promise<AuthProfile | null> {
  const sb = supabaseBrowser();

  const { data: authData, error: authError } = await sb.auth.getUser();
  if (authError) throw authError;

  const userId = authData?.user?.id;
  if (!userId) return null;

  const { data, error } = await sb
    .from("profiles")
    .select("id, role, vessel_id, full_name")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return (data as AuthProfile | null) || null;
}

export async function requireShipAccess() {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("NOT_LOGGED_IN");

  const roles = parseRoles(profile.role);
  if (!roles.has("ship")) throw new Error("NO_SHIP_ACCESS");

  return profile;
}

export async function requireShoreAccess() {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("NOT_LOGGED_IN");

  const roles = parseRoles(profile.role);
  if (!roles.has("shore")) throw new Error("NO_SHORE_ACCESS");

  return profile;
}