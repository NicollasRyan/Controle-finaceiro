import type { Metadata } from "next";
import "./styles.css";
export const metadata: Metadata = { title: "Fluxo — Controle financeiro", description: "Seu dinheiro, com clareza." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="pt-BR"><body>{children}</body></html>; }
