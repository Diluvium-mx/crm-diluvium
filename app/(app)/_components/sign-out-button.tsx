"use client";

// «Cerrar sesión» de la barra de arriba: ya no sale directo, abre el globo de confirmación
// pegado al botón (sign-out-confirm.tsx).
import { useState } from "react";
import { SignOutConfirm } from "./sign-out-confirm";

export function SignOutButton() {
  const [open, setOpen] = useState(false);

  return (
    <SignOutConfirm
      open={open}
      onOpenChange={setOpen}
      trigger={
        <button
          type="button"
          className="rounded border border-white/30 px-3 py-1.5 text-sm text-white transition-colors hover:bg-white/10"
        >
          Cerrar sesión
        </button>
      }
    />
  );
}
