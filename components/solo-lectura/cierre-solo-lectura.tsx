"use client";

// Lo que se dibuja en lugar de una ventana de confirmar (borrar, guardar, cambiar…) cuando la pestaña es de
// «Solo lectura» (27-nov-2026, decisión del dueño: el aviso sale ANTES de la ventana, nunca después). Avisa y le
// dice a quien la abrió que se cerró, para que nada se quede abierto ni en «Guardando…». No dibuja nada.
import { useEffect, useRef } from "react";
import { avisar } from "@/lib/auth/solo-lectura-navegador";

export function CierreSoloLectura({ onCerrar }: { onCerrar: () => void }) {
  const cerrar = useRef(onCerrar);
  useEffect(() => {
    avisar();
    cerrar.current();
  }, []);
  return null;
}
