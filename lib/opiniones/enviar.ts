// Envío del formulario público a /api/opinion desde el navegador (docs/opiniones.md).
// La página no lleva lógica de datos: solo llama a esto.
import type { RespuestaEntrada } from "./respuestas";

export type EnvioOpinion =
  | { ok: true }
  | { ok: false; yaContestada: boolean; message: string };

export async function enviarOpinion(respuesta: RespuestaEntrada): Promise<EnvioOpinion> {
  try {
    const res = await fetch("/api/opinion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(respuesta),
    });
    const data = (await res.json().catch(() => null)) as { ok?: boolean; resultado?: string; message?: string } | null;
    if (res.ok && data?.ok) return { ok: true };
    if (res.status === 429) {
      return { ok: false, yaContestada: false, message: "Son muchos intentos seguidos. Espere unos minutos." };
    }
    return {
      ok: false,
      yaContestada: data?.resultado === "ya_contestada",
      message: data?.message ?? "No se pudo enviar. Intente de nuevo.",
    };
  } catch {
    return { ok: false, yaContestada: false, message: "Sin conexión. Revise su internet e intente de nuevo." };
  }
}
