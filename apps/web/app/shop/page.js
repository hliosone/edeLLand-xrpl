"use client";

import { useRouter } from "next/navigation";
import { ShoppingCart, Zap, Shield, Star } from "lucide-react";

// ── Products catalogue ────────────────────────────────────────────────────────

const PRODUCTS = [
  {
    id:       "iphone-15-pro",
    emoji:    "📱",
    name:     "iPhone 15 Pro",
    specs:    "A17 Pro · 256 GB · Titanium",
    price:    899,
    badge:    "Bestseller",
    badgeColor: "#f59e0b",
  },
  {
    id:       "macbook-air-m3",
    emoji:    "💻",
    name:     "MacBook Air M3",
    specs:    "M3 · 16 GB RAM · 512 GB SSD",
    price:    1399,
    badge:    "New",
    badgeColor: "#10b981",
  },
  {
    id:       "sony-wh1000xm5",
    emoji:    "🎧",
    name:     "Sony WH-1000XM5",
    specs:    "ANC · 30h battery · Multipoint",
    price:    279,
    badge:    null,
    badgeColor: null,
  },
  {
    id:       "samsung-qled-55",
    emoji:    "📺",
    name:     "Samsung QLED 55\"",
    specs:    "4K 120Hz · HDR10+ · Smart TV",
    price:    649,
    badge:    "Sale",
    badgeColor: "#ef4444",
  },
  {
    id:       "ps5-slim",
    emoji:    "🎮",
    name:     "PlayStation 5 Slim",
    specs:    "1TB SSD · 4K 120fps · Disc Edition",
    price:    449,
    badge:    null,
    badgeColor: null,
  },
  {
    id:       "dyson-v15",
    emoji:    "🌀",
    name:     "Dyson V15 Detect",
    specs:    "Laser detection · 60min · HEPA",
    price:    649,
    badge:    null,
    badgeColor: null,
  },
];

// ── Installment estimate (3× equal, InterestRate=0, 8% origination fee upfront) ──

function installmentEstimate(price) {
  return (price / 3).toFixed(2);
}

// ── Product card ──────────────────────────────────────────────────────────────

function ProductCard({ product, onBuy }) {
  const monthly = installmentEstimate(product.price);
  return (
    <div
      className="rounded-2xl p-5 flex flex-col gap-4 transition-all duration-200 hover:scale-[1.01]"
      style={{
        background:   "rgba(255,255,255,0.035)",
        border:       "1px solid rgba(255,255,255,0.09)",
        backdropFilter: "blur(8px)",
      }}
    >
      {/* Top */}
      <div className="flex items-start justify-between">
        <div
          className="flex h-14 w-14 items-center justify-center rounded-2xl text-3xl"
          style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}
        >
          {product.emoji}
        </div>
        {product.badge && (
          <span
            className="px-2.5 py-0.5 rounded-full text-xs font-semibold"
            style={{
              background: product.badgeColor + "22",
              color:      product.badgeColor,
              border:     `1px solid ${product.badgeColor}44`,
            }}
          >
            {product.badge}
          </span>
        )}
      </div>

      {/* Info */}
      <div>
        <p className="font-semibold" style={{ color: "rgba(241,245,249,0.92)", fontSize: "15px" }}>
          {product.name}
        </p>
        <p style={{ color: "rgba(241,245,249,0.38)", fontSize: "12.5px", marginTop: "2px" }}>
          {product.specs}
        </p>
      </div>

      {/* Price */}
      <div>
        <p className="font-bold" style={{ color: "rgba(241,245,249,0.95)", fontSize: "22px" }}>
          {product.price.toLocaleString()} <span style={{ fontSize: "13px", color: "rgba(241,245,249,0.4)" }}>RLUSD</span>
        </p>
        <p style={{ color: "rgba(241,245,249,0.35)", fontSize: "12px", marginTop: "2px" }}>
          or 3× {monthly} RLUSD / every 5 min
        </p>
      </div>

      {/* CTA */}
      <button
        onClick={() => onBuy(product)}
        className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold transition-all duration-150 hover:opacity-90 active:scale-95"
        style={{
          background:   "linear-gradient(135deg, #00d4ff, #7c3aed)",
          color:        "#fff",
          border:       "none",
        }}
      >
        <ShoppingCart className="h-4 w-4" />
        Buy now, pay in 3×*
      </button>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ShopPage() {
  const router = useRouter();

  function handleBuy(product) {
    const params = new URLSearchParams({
      amount:    String(product.price),
      product:   product.name,
      productId: product.id,
      merchant:  "TechZone",
      returnUrl: "/shop",
    });
    router.push(`/checkout?${params.toString()}`);
  }

  return (
    <div className="min-h-screen" style={{ background: "#08090e" }}>

      {/* Hero banner */}
      <div
        className="w-full py-10 px-4"
        style={{
          background:    "linear-gradient(135deg, rgba(0,212,255,0.07) 0%, rgba(124,58,237,0.07) 100%)",
          borderBottom:  "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-3 mb-3">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-xl text-xl"
              style={{ background: "linear-gradient(135deg,#00d4ff,#7c3aed)" }}
            >
              ⚡
            </div>
            <div>
              <p className="font-bold text-xl" style={{ color: "rgba(241,245,249,0.95)" }}>TechZone</p>
              <p style={{ color: "rgba(241,245,249,0.35)", fontSize: "12px" }}>
                High-end electronics · RLUSD · Powered by edeLLand
              </p>
            </div>
          </div>
          <h1 className="text-3xl font-bold mt-4" style={{ color: "rgba(241,245,249,0.95)" }}>
            Buy now,<br />
            <span style={{ background: "linear-gradient(135deg,#00d4ff,#7c3aed)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              pay in 3 installments
            </span>
          </h1>
          <p className="mt-2" style={{ color: "rgba(241,245,249,0.4)", fontSize: "14px" }}>
            Finance your purchase with an on-chain loan signed in seconds. KYC required.
          </p>

          {/* Trust badges */}
          <div className="flex flex-wrap gap-4 mt-6">
            {[
              { icon: <Shield className="h-3.5 w-3.5" />, label: "KYC verified on-chain" },
              { icon: <Zap className="h-3.5 w-3.5" />,    label: "Instant signing" },
              { icon: <Star className="h-3.5 w-3.5" />,   label: "8% origination fee" },
            ].map(({ icon, label }) => (
              <div
                key={label}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)", color: "rgba(241,245,249,0.55)" }}
              >
                {icon}
                {label}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Product grid */}
      <div className="max-w-5xl mx-auto px-4 py-10">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {PRODUCTS.map((p) => (
            <ProductCard key={p.id} product={p} onBuy={handleBuy} />
          ))}
        </div>

        {/* Fine print */}
        <p
          className="text-center mt-10"
          style={{ color: "rgba(241,245,249,0.2)", fontSize: "11px", lineHeight: 1.7 }}
        >
          *8% origination fee deducted upfront · 3 equal installments every 5 min · KYC_FULL required · Loan issued on XRPL ·
          TechZone is a demo store. No real delivery.
        </p>
      </div>
    </div>
  );
}
