"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { WalletConnector } from "./WalletConnector";
import { useWallet } from "./providers/WalletProvider";
import { useWalletManager } from "../hooks/useWalletManager";

const NAV_LINKS = [
  { href: "/account",    label: "Account",    auth: true  },
  { href: "/loans",      label: "Loans",      auth: true  },
  { href: "/yield",      label: "Yield",      auth: true  },
  { href: "/onboarding", label: "KYC",        auth: false },
  { href: "/admin",      label: "Admin",      auth: false },
];

const HIDDEN_PATHS = ["/shop", "/checkout"];

export function Header() {
  useWalletManager();
  const { statusMessage, isConnected } = useWallet();
  const pathname = usePathname();

  if (HIDDEN_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) return null;

  return (
    <header
      className="sticky top-0 z-50 w-full"
      style={{
        background: "rgba(8, 9, 14, 0.85)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
      }}
    >
      <div className="container flex h-14 items-center gap-6">

        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 flex-shrink-0" style={{ textDecoration: "none" }}>
          <div
            className="flex h-8 w-8 items-center justify-center rounded-lg font-bold text-sm text-white"
            style={{ background: "linear-gradient(135deg, #00d4ff, #7c3aed)" }}
          >
            E
          </div>
          <span className="font-semibold text-sm tracking-wide" style={{ color: "rgba(241,245,249,0.9)" }}>
            ede<span style={{ color: "#00d4ff" }}>LL</span>and
          </span>
        </Link>

        {/* Nav */}
        <nav className="flex items-center gap-0.5">
          {NAV_LINKS.filter((l) => !l.auth || isConnected).map(({ href, label }) => {
            const isActive = pathname === href || pathname.startsWith(href + "/");
            return (
              <Link
                key={href}
                href={href}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                  isActive
                    ? "text-[#00d4ff] bg-[rgba(0,212,255,0.09)]"
                    : "text-white/40 hover:text-white/75 hover:bg-white/5"
                }`}
              >
                {label}
              </Link>
            );
          })}
        </nav>

        {/* Right */}
        <div className="flex flex-1 items-center justify-end gap-3">
          {statusMessage && (
            <div
              className="px-3 py-1 rounded-full text-xs font-medium"
              style={{
                background:
                  statusMessage.type === "success" ? "rgba(16,185,129,0.12)"
                  : statusMessage.type === "error"  ? "rgba(239,68,68,0.12)"
                  : "rgba(255,255,255,0.06)",
                color:
                  statusMessage.type === "success" ? "#10b981"
                  : statusMessage.type === "error"  ? "#f87171"
                  : "rgba(241,245,249,0.55)",
                border: "1px solid",
                borderColor:
                  statusMessage.type === "success" ? "rgba(16,185,129,0.25)"
                  : statusMessage.type === "error"  ? "rgba(239,68,68,0.25)"
                  : "rgba(255,255,255,0.08)",
              }}
            >
              {statusMessage.message}
            </div>
          )}
          <WalletConnector />
        </div>
      </div>
    </header>
  );
}
