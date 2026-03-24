"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

type AppRole = "ship" | "shore" | "admin";

type ProfileRow = {
  id: string;
  role: AppRole | string | null;
  vessel_id: string | null;
  full_name: string | null;
};

function parseRoles(role: string | null | undefined) {
  return new Set(
    String(role || "")
      .toLowerCase()
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
  );
}

export default function LoginPage() {
  const router = useRouter();
  const sb = supabaseBrowser();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [roleHint, setRoleHint] = useState<"ship" | "shore">("ship");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  async function onLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg("");

    try {
      if (!email.trim()) throw new Error("Please enter email.");
      if (!password.trim()) throw new Error("Please enter password.");

      const { data: authData, error: authError } = await sb.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (authError) {
        throw new Error(authError.message || "Invalid email or password.");
      }

      const userId = authData.user?.id;
      if (!userId) {
        throw new Error("Login succeeded but user record was not returned.");
      }

      const { data: profile, error: profileError } = await sb
        .from("profiles")
        .select("id, role, vessel_id, full_name")
        .eq("id", userId)
        .maybeSingle();

      if (profileError) {
        throw new Error(profileError.message || "Unable to load user profile.");
      }

      if (!profile) {
        throw new Error("No profile found for this account.");
      }

      const roles = parseRoles(profile.role);

      if (roles.size === 0) {
        throw new Error("No role assigned to this account.");
      }

      if (roles.has("ship") && roles.has("shore")) {
        if (roleHint === "ship") {
          router.push("/ship");
        } else {
          router.push("/shore");
        }
        return;
      }

      if (roles.has("ship")) {
        router.push("/ship");
        return;
      }

      if (roles.has("shore")) {
        router.push("/shore");
        return;
      }

      if (roles.has("admin")) {
        router.push("/dashboard");
        return;
      }

      throw new Error(`Unsupported role configuration: ${profile.role}`);
    } catch (err: any) {
      setMsg(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  async function onForgotPassword() {
    try {
      setMsg("");

      if (!email.trim()) {
        setMsg("Enter your email first, then click Reset Password.");
        return;
      }

      const origin = typeof window !== "undefined" ? window.location.origin : "";

      const { error } = await sb.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${origin}/login`,
      });

      if (error) {
        throw new Error(error.message || "Unable to send reset email.");
      }

      setMsg("Password reset email sent. Please check your inbox.");
    } catch (err: any) {
      setMsg(err?.message || String(err));
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "linear-gradient(180deg, #0f172a 0%, #1e293b 35%, #f8fafc 35%, #f8fafc 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 1080,
          display: "grid",
          gridTemplateColumns: "1.1fr 0.9fr",
          background: "#ffffff",
          borderRadius: 28,
          overflow: "hidden",
          boxShadow: "0 24px 60px rgba(15, 23, 42, 0.20)",
          border: "1px solid #e2e8f0",
        }}
      >
        <div
          style={{
            padding: 40,
            background:
              "linear-gradient(135deg, #0f172a 0%, #1d4ed8 60%, #38bdf8 100%)",
            color: "#fff",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            minHeight: 620,
          }}
        >
          <div>
            <div
              style={{
                width: 84,
                height: 84,
                borderRadius: 24,
                background: "#ffffff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
                boxShadow: "0 8px 20px rgba(0,0,0,0.12)",
                padding: 8,
              }}
            >
              <img
                src="/company-logo.png"
                alt="Company Logo"
                style={{ width: "100%", height: "100%", objectFit: "contain" }}
              />
            </div>

            <h1 style={{ marginTop: 28, fontSize: 34, lineHeight: 1.15, fontWeight: 800 }}>
              Marine Rust Inspection Platform
            </h1>

            <p
              style={{
                marginTop: 16,
                fontSize: 16,
                lineHeight: 1.7,
                color: "rgba(255,255,255,0.92)",
              }}
            >
              A professional workspace for vessel corrosion inspection, photo uploads,
              review and approval, pictorial corrosion mapping, dashboards, and report generation.
            </p>
          </div>

          <div
            style={{
              marginTop: 24,
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
            }}
          >
            <InfoCard title="Ship Workspace" text="Fast upload, tagging, and submission for onboard crew." />
            <InfoCard title="Shore Workspace" text="Review, approval, reports, dashboard, and history." />
            <InfoCard title="Pictorial Maps" text="Main deck and cargo hold corrosion sheets with severity colors." />
            <InfoCard title="Structured Reporting" text="Professional PDF reporting with inspection detail pages." />
          </div>
        </div>

        <div
          style={{
            padding: 40,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            background: "#ffffff",
          }}
        >
          <div style={{ maxWidth: 420, width: "100%", margin: "0 auto" }}>
            <div style={{ color: "#0f172a", fontSize: 30, fontWeight: 800 }}>
              Sign in
            </div>
            <div style={{ marginTop: 8, color: "#64748b", fontSize: 14 }}>
              Sign in with your registered account. Workspace routing follows your assigned role.
            </div>

            <form onSubmit={onLogin} style={{ marginTop: 28 }}>
              <label style={labelStyle}>Email</label>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                placeholder="name@company.com"
                autoComplete="email"
                style={inputStyle}
              />

              <label style={{ ...labelStyle, marginTop: 16 }}>Password</label>
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                placeholder="Enter password"
                autoComplete="current-password"
                style={inputStyle}
              />

              <label style={{ ...labelStyle, marginTop: 16 }}>Preferred Workspace</label>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 10,
                  marginTop: 8,
                }}
              >
                <RoleButton
                  active={roleHint === "ship"}
                  title="Ship"
                  subtitle="Onboard upload sheet"
                  onClick={() => setRoleHint("ship")}
                />
                <RoleButton
                  active={roleHint === "shore"}
                  title="Shore"
                  subtitle="Review, reports, dashboard"
                  onClick={() => setRoleHint("shore")}
                />
              </div>

              <div
                style={{
                  marginTop: 10,
                  fontSize: 12,
                  color: "#64748b",
                  lineHeight: 1.5,
                }}
              >
                Multi-role users such as admin accounts can choose Ship or Shore here.
                Single-role users will be routed automatically.
              </div>

              <button
                type="submit"
                disabled={loading}
                style={{
                  width: "100%",
                  marginTop: 24,
                  padding: "14px 16px",
                  borderRadius: 16,
                  border: "1px solid #0f172a",
                  background: loading
                    ? "#cbd5e1"
                    : "linear-gradient(135deg, #0f172a 0%, #1d4ed8 100%)",
                  color: "#fff",
                  fontWeight: 800,
                  fontSize: 15,
                  cursor: loading ? "not-allowed" : "pointer",
                  boxShadow: loading ? "none" : "0 10px 24px rgba(29, 78, 216, 0.20)",
                }}
              >
                {loading ? "Signing in..." : "Open Workspace"}
              </button>

              <button
                type="button"
                onClick={onForgotPassword}
                style={{
                  width: "100%",
                  marginTop: 10,
                  padding: "12px 16px",
                  borderRadius: 14,
                  border: "1px solid #cbd5e1",
                  background: "#fff",
                  color: "#0f172a",
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: "pointer",
                }}
              >
                Reset Password
              </button>

              {msg && (
                <div
                  style={{
                    marginTop: 14,
                    padding: 12,
                    borderRadius: 14,
                    background: msg.toLowerCase().includes("sent")
                      ? "#ecfdf5"
                      : "#fef2f2",
                    border: msg.toLowerCase().includes("sent")
                      ? "1px solid #a7f3d0"
                      : "1px solid #fecaca",
                    color: msg.toLowerCase().includes("sent")
                      ? "#065f46"
                      : "#b91c1c",
                    fontSize: 14,
                    fontWeight: 700,
                  }}
                >
                  {msg}
                </div>
              )}
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoCard({ title, text }: { title: string; text: string }) {
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.12)",
        border: "1px solid rgba(255,255,255,0.18)",
        borderRadius: 18,
        padding: 16,
        backdropFilter: "blur(6px)",
      }}
    >
      <div style={{ fontWeight: 800, fontSize: 15 }}>{title}</div>
      <div
        style={{
          marginTop: 6,
          fontSize: 13,
          lineHeight: 1.6,
          color: "rgba(255,255,255,0.92)",
        }}
      >
        {text}
      </div>
    </div>
  );
}

function RoleButton({
  active,
  title,
  subtitle,
  onClick,
}: {
  active: boolean;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        textAlign: "left",
        padding: 14,
        borderRadius: 16,
        border: active ? "2px solid #1d4ed8" : "1px solid #cbd5e1",
        background: active ? "#eff6ff" : "#fff",
        cursor: "pointer",
      }}
    >
      <div style={{ fontWeight: 800, color: "#0f172a" }}>{title}</div>
      <div style={{ marginTop: 4, fontSize: 12, color: "#64748b" }}>{subtitle}</div>
    </button>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontWeight: 700,
  color: "#0f172a",
  fontSize: 14,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  marginTop: 8,
  padding: "12px 14px",
  borderRadius: 14,
  border: "1px solid #cbd5e1",
  background: "#fff",
  color: "#0f172a",
  fontSize: 14,
};