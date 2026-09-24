"use client";

// Interruptor que se RECUERDA en esta computadora (localStorage): paneles que el
// vendedor oculta (Detalle del contacto en el pop-up del Embudo, lista y detalle
// de la Bandeja) siguen ocultos al cambiar de contacto, cerrar y abrir, recargar
// o al día siguiente, hasta que los vuelva a mostrar. Sin almacenamiento (modo
// privado, bloqueado) queda el valor por defecto y no falla.
// useSyncExternalStore: en el servidor y durante la hidratación vale el default;
// en cuanto hidrata, React vuelve a pintar de forma síncrona con lo guardado
// (sin parpadeo visible). Los cambios se avisan a todos los usos del mismo key.
import { useCallback, useSyncExternalStore } from "react";

const PREFIX = "diluvium.ui.";
const listeners = new Set<() => void>();

function read(key: string): boolean | null {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw === "1" ? true : raw === "0" ? false : null;
  } catch {
    return null;
  }
}

// Sin almacenamiento, el valor vive aquí mientras dure la página.
const memory = new Map<string, boolean>();

function write(key: string, value: boolean): void {
  memory.set(key, value);
  try {
    window.localStorage.setItem(PREFIX + key, value ? "1" : "0");
  } catch {
    // sin almacenamiento: se queda en memoria
  }
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  window.addEventListener("storage", fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", fn);
  };
}

export function usePersistentToggle(key: string, defaultValue = true): [boolean, (next: boolean | ((current: boolean) => boolean)) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => read(key) ?? memory.get(key) ?? defaultValue,
    () => defaultValue,
  );
  const set = useCallback(
    (next: boolean | ((current: boolean) => boolean)) => {
      const current = read(key) ?? memory.get(key) ?? defaultValue;
      write(key, typeof next === "function" ? next(current) : next);
    },
    [key, defaultValue],
  );
  return [value, set];
}
