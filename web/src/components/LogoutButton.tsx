"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

export default function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onLogout() {
    try {
      setBusy(true);
      const sb = supabaseBrowser();
      await sb.auth.signOut();
      router.replace("/login");
    } catch (e) {
      console.error("Logout failed:", e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={onLogout}
      disabled={busy}
      style={{
        padding: "10px 18px",
        borderRadius: 12,
        border: "1px solid #cbd5e1",
        background: "#ffffff",
        color: "#0f172a",
        fontWeight: 800,
        fontSize: 13,
        cursor: busy ? "not-allowed" : "pointer",
        boxShadow: "0 6px 14px rgba(15, 23, 42, 0.08)",
        minWidth: 92,
      }}
    >
      {busy ? "Signing out..." : "Logout"}
    </button>
  );
}