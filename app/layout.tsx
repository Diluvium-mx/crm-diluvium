import type { Metadata, Viewport } from "next";
import { ThemeProvider } from "@/components/theme-provider";
import { GlowPointer } from "@/components/ui/glow-pointer";
import "./globals.css";

export const metadata: Metadata = {
  title: "CRM Diluvium",
  description: "CRM conversacional de Diluvium",
};

// Versión móvil: ancho del dispositivo, sin zoom raro al enfocar un campo, la
// pantalla ocupa hasta los bordes (safe areas con env()) y el teclado en Android
// ENCOGE la vista (interactiveWidget) en vez de taparla: así la caja para escribir
// del chat (abajo de un alto 100dvh) queda a la vista mientras se escribe.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: "#245595",
};

// Tipografía de marca (Helvetica → Arial/Helvetica Neue como respaldo) vía el
// token --font-sans en globals.css; sin next/font/google, así que el build no
// depende de descargar fuentes.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className="h-full antialiased" suppressHydrationWarning>
      <body className="min-h-full flex flex-col">
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
          {children}
        </ThemeProvider>
        {/* Luz del "fondo iluminado" que sigue al cursor (app/globals.css). */}
        <GlowPointer />
      </body>
    </html>
  );
}
