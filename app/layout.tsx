import type { Metadata } from "next";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "CRM Diluvium",
  description: "CRM conversacional de Diluvium",
};

// Tipografía de marca (Helvetica → Arial/Helvetica Neue como respaldo) vía el
// token --font-sans en globals.css; sin next/font/google, así que el build no
// depende de descargar fuentes.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className="h-full antialiased" suppressHydrationWarning>
      <body className="min-h-full flex flex-col">
        <ThemeProvider attribute="class" forcedTheme="light">
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
