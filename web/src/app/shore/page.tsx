"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import LogoutButton from "@/components/LogoutButton";
import ReviewPage from "../review/page";
import ReportsPage from "../reports/page";
import DashboardPage from "../dashboard/page";

type ShoreTab = "review" | "reports" | "dashboard";

export default function ShorePage() {
  const router = useRouter();
  const supabase = supabaseBrowser();

  const [tab, setTab] = useState<ShoreTab>("review");
  const [checkingAccess, setCheckingAccess] = useState(true);

  useEffect(() => {
    async function checkAccess() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push("/login");
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

      if (!profile) {
        router.push("/login");
        return;
      }

      const role = (profile.role || "").toLowerCase();

      if (role.includes("shore")) {
        setCheckingAccess(false);
        return;
      }

      if (role.includes("ship")) {
        setCheckingAccess(false);
        return;
      }

      router.push("/login");
    }

    checkAccess();
  }, [router, supabase]);

  if (checkingAccess) {
    return <div style={{ padding: 40, fontWeight: 600 }}>Checking access...</div>;
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "16px 24px",
          maxWidth: 1400,
          margin: "0 auto",
        }}
      >
        <h1 style={{ fontSize: 22, fontWeight: 800 }}>Shore Workspace</h1>
        <LogoutButton />
      </div>

      <TopHeader
        title="Shore Inspection Control"
        subtitle="Review, approval, reports and dashboard workspace"
        badge="SHORE WORKSPACE"
      />

      <div style={{ maxWidth: 1440, margin: "0 auto", padding: 20 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "280px 1fr",
            gap: 18,
          }}
        >
          <aside
            style={{
              background: "#ffffff",
              border: "1px solid #e2e8f0",
              borderRadius: 24,
              padding: 18,
              boxShadow: "0 10px 24px rgba(15,23,42,0.05)",
              height: "fit-content",
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 800, color: "#64748b", marginBottom: 12 }}>
              CONTROL MENU
            </div>

            <SideNavButton
              active={tab === "review"}
              label="Inspection Review / Approval"
              hint="Live review module"
              onClick={() => setTab("review")}
            />
            <SideNavButton
              active={tab === "reports"}
              label="Rust Inspection Reports"
              hint="Live reports module"
              onClick={() => setTab("reports")}
            />
            <SideNavButton
              active={tab === "dashboard"}
              label="Dashboard"
              hint="Live dashboard module"
              onClick={() => setTab("dashboard")}
            />
          </aside>

          <main style={{ display: "grid", gap: 18 }}>
            {tab === "review" && (
              <Card title="Live Review Module" subtitle="Connected to your real review page">
                <ReviewPage />
              </Card>
            )}

            {tab === "reports" && (
              <Card title="Live Reports Module" subtitle="Connected to your real reports page">
                <ReportsPage />
              </Card>
            )}

            {tab === "dashboard" && (
              <Card title="Live Dashboard Module" subtitle="Connected to your real dashboard page">
                <DashboardPage />
              </Card>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

function TopHeader({
  title,
  subtitle,
  badge,
}: {
  title: string;
  subtitle: string;
  badge: string;
}) {
  return (
    <div
      style={{
        background: "linear-gradient(135deg, #0f172a 0%, #1d4ed8 100%)",
        color: "#fff",
        padding: "18px 24px",
        boxShadow: "0 10px 24px rgba(15,23,42,0.12)",
      }}
    >
      <div
        style={{
          maxWidth: 1440,
          margin: "0 auto",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              width: 60,
              height: 60,
              borderRadius: 18,
              background: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
              padding: 6,
            }}
          >
            <img
              src="/company-logo.png"
              alt="Company Logo"
              style={{ width: "100%", height: "100%", objectFit: "contain" }}
            />
          </div>

          <div>
            <div style={{ fontSize: 26, fontWeight: 800 }}>{title}</div>
            <div style={{ marginTop: 4, color: "rgba(255,255,255,0.86)", fontSize: 14 }}>
              {subtitle}
            </div>
          </div>
        </div>

        <div
          style={{
            padding: "10px 14px",
            borderRadius: 999,
            background: "rgba(255,255,255,0.12)",
            border: "1px solid rgba(255,255,255,0.18)",
            fontWeight: 800,
            fontSize: 13,
          }}
        >
          {badge}
        </div>
      </div>
    </div>
  );
}

function SideNavButton({
  active,
  label,
  hint,
  onClick,
}: {
  active: boolean;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        width: "100%",
        textAlign: "left",
        padding: 14,
        borderRadius: 16,
        border: active ? "2px solid #1d4ed8" : "1px solid #e2e8f0",
        background: active ? "#eff6ff" : "#fff",
        marginBottom: 10,
        cursor: "pointer",
      }}
    >
      <div style={{ fontWeight: 800, color: "#0f172a" }}>{label}</div>
      <div style={{ marginTop: 4, fontSize: 12, color: "#64748b" }}>{hint}</div>
    </button>
  );
}

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "#ffffff",
        border: "1px solid #e2e8f0",
        borderRadius: 24,
        padding: 18,
        boxShadow: "0 10px 24px rgba(15,23,42,0.05)",
      }}
    >
      <div style={{ fontSize: 20, fontWeight: 800, color: "#0f172a" }}>{title}</div>
      <div style={{ marginTop: 4, color: "#64748b", fontSize: 13 }}>{subtitle}</div>
      <div style={{ marginTop: 16 }}>{children}</div>
    </div>
  );
}