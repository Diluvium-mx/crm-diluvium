// Versión del CRM que atiende este servidor: la marca que puso el build (next.config.ts).
// El navegador la pregunta SOLO cuando algo falló, para saber si su pestaña es de una
// versión anterior (aviso «Hay una nueva actualización del CRM», lib/version/client.ts).
// No lleva datos de nadie, así que no pide sesión.
export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json(
    { version: process.env.NEXT_PUBLIC_CRM_VERSION ?? "" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
