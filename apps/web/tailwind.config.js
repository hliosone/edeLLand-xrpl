/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{js,jsx}",
    "./components/**/*.{js,jsx}",
    "../../packages/ui/**/*.{js,jsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "orb": {
          "0%, 100%": { transform: "translate(0, 0) scale(1)" },
          "25%":  { transform: "translate(50px, -40px) scale(1.08)" },
          "50%":  { transform: "translate(-20px, 50px) scale(0.94)" },
          "75%":  { transform: "translate(30px, 20px) scale(1.03)" },
        },
        "slide-up": {
          "from": { opacity: "0", transform: "translateY(28px)" },
          "to":   { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          "from": { opacity: "0" },
          "to":   { opacity: "1" },
        },
        "glow-pulse": {
          "0%, 100%": { boxShadow: "0 0 8px rgba(0,212,255,0.25)" },
          "50%":       { boxShadow: "0 0 24px rgba(0,212,255,0.6), 0 0 48px rgba(0,212,255,0.2)" },
        },
        "shimmer": {
          "0%":   { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
      animation: {
        "orb":        "orb 22s ease-in-out infinite",
        "orb-slow":   "orb 30s ease-in-out infinite reverse",
        "orb-alt":    "orb 18s ease-in-out infinite alternate",
        "slide-up":   "slide-up 0.6s ease-out forwards",
        "fade-in":    "fade-in 0.4s ease-out forwards",
        "glow-pulse": "glow-pulse 2.5s ease-in-out infinite",
        "shimmer":    "shimmer 2.5s linear infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
