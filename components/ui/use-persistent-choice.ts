"use client";

// Elección de UNA opción entre varias (o ninguna) que se RECUERDA en esta computadora (localStorage), como
// use-persistent-toggle pero con un texto en lugar de sí/no. 21-nov-2026: las tarjetas chicas de costos del Dashboard
// abren una sola a la vez («Desglosar»): al abrir una se cierra la otra. Sin almacenamiento (modo privado, bloqueado)
// queda el valor por defecto mientras dure la página y no falla. En el servidor y al hidratar vale el default.
import { useCallback, useSyncExternalStore } from "react";

const PREFIX = "diluvium.ui.";
const listeners = new Set<() => void>();
// Sin almacenamiento, el valor vive aquí mientras dure la página.
const memory = new Map<string, string | null>();

function read(key: string): string | null | undefined {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (raw === null) return undefined;
    return raw === "" ? null : raw;
  } catch {
    return undefined;
  }
}

function write(key: string, value: string | null): void {
  memory.set(key, value);
  try {
    window.localStorage.setItem(PREFIX + key, value ?? "");
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

function current(key: string, defaultValue: string | null): string | null {
  const stored = read(key);
  if (stored !== undefined) return stored;
  return memory.has(key) ? (memory.get(key) ?? null) : defaultValue;
}

export function usePersistentChoice(key: string, defaultValue: string | null = null): [string | null, (next: string | null) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => current(key, defaultValue),
    () => defaultValue,
  );
  const set = useCallback((next: string | null) => write(key, next), [key]);
  return [value, set];
}
