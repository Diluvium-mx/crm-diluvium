import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
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
