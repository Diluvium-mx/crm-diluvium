"use client";

// Rol «Solo lectura» (26-nov-2026, lib/auth/solo-lectura.ts): cuando una pantalla deja escapar el
// rechazo de una Server Action (p. ej. dentro de startTransition), React lo manda aquí. Ya salió el
// aviso «Modo solo lectura» (lo reconoce la respuesta misma), así que solo se vuelve a dibujar la
// pantalla. Cualquier otro error sube igual que antes de que existiera este archivo.
import { useEffect } from "react";
import { esRechazoSoloLectura } from "@/lib/auth/solo-lectura";

// Fuera del componente: cada error monta uno nuevo.
let ultimoReinicio = 0;

export default function AppError({ error, reset }: { error: unknown; reset: () => void }) {
  const soloLectura = esRechazoSoloLectura(error);
  useEffect(() => {
    if (!soloLectura) return;
    // Un rechazo que se repitiera al dibujar no debe quedar en un ciclo sin fin.
    if (Date.now() - ultimoReinicio < 1_000) return;
    ultimoReinicio = Date.now();
    reset();
  }, [soloLectura, reset, error]);
  if (!soloLectura) throw error;
  return null;
}
