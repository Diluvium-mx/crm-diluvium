import type { NextConfig } from "next";

// Cabeceras de seguridad en TODAS las respuestas (S2, revisión de seguridad
// CN-004, 30-sep-2026). La política de contenido (CSP) va primero en modo
// "Report-Only": no bloquea nada, solo avisa en la consola del navegador lo que
// bloquearía; cuando esté limpia en staging y producción se pasa a obligatoria.
// Media y archivos vienen del bucket de Railway (<bucket>.t3.storageapi.dev) por
// URL firmada; las miniaturas de anuncios, de Meta (https).
const BUCKET = "https://*.t3.storageapi.dev";
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  `media-src 'self' blob: ${BUCKET}`,
  `frame-src 'self' ${BUCKET}`,
  "connect-src 'self'",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Content-Security-Policy-Report-Only", value: CSP_REPORT_ONLY },
];

const nextConfig: NextConfig = {
  output: "standalone",
  // No anunciar "x-powered-by: Next.js".
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  experimental: {
    serverActions: {
      // La importación de contactos sube el CSV por un Server Action. El export
      // real de GHL pesa ~2.4 MB (10,902 filas) y seguirá creciendo; el límite
      // por defecto de Next (1 MB) lo rechazaría antes de llegar al código. Se
      // sube con holgura (incluye el overhead de multipart). El tamaño real del
      // archivo se valida además en lib/actions/contacts.ts.
      bodySizeLimit: "16mb",
    },
  },
};

export default nextConfig;
