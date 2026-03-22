"use client";

import "./globals.css";
import { WalletProvider } from "../components/providers/WalletProvider";
import { Header } from "../components/Header";

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <WalletProvider>
          <Header />
          {children}
        </WalletProvider>
      </body>
    </html>
  );
}
