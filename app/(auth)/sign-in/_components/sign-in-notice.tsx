"use client";

// Aviso arriba del formulario de entrada cuando se llega con `?aviso=` (p. ej. después de
// cambiar la contraseña en «Mi cuenta»). Sin aviso conocido no pinta nada.
import { useSearchParams } from "next/navigation";
import { signInNoticeText } from "@/lib/auth/sign-in-notice";

export function SignInNotice() {
  const text = signInNoticeText(useSearchParams().get("aviso"));
  if (!text) return null;
  return (
    <p role="status" className="mb-4 rounded-md bg-brand-navy/10 px-3 py-2 text-sm text-brand-navy dark:text-sky-300">
      <span className="mr-1.5 font-semibold">✓</span>
      {text}
    </p>
  );
}
