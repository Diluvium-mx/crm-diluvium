"use client";

import { useRef, useState, useTransition, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { importContactsFromCsv, type ImportContactsFromCsvResult } from "@/lib/actions/contacts";

export function ImportContactsButton() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<ImportContactsFromCsvResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Permite re-seleccionar el mismo archivo (ej. tras corregirlo) sin que
    // el navegador ignore el segundo onChange por ser el mismo path.
    event.target.value = "";

    if (!file) {
      return;
    }

    setError(null);
    setResult(null);

    const formData = new FormData();
    formData.set("file", file);

    startTransition(async () => {
      try {
        const importResult = await importContactsFromCsv(formData);
        setResult(importResult);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "No se pudo importar el CSV.");
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={isPending}
          className="rounded bg-brand-orange px-3 py-2 text-sm font-medium text-brand-white transition-colors hover:bg-brand-orange-light disabled:opacity-60"
        >
          {isPending ? "Importando…" : "Importar CSV"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>

      {error && <p className="max-w-xs text-right text-sm text-brand-orange">{error}</p>}

      {result && (
        <p className="max-w-xs text-right text-xs text-muted-foreground">
          Importados: {result.imported} · Actualizados: {result.updated} · Sin teléfono válido:{" "}
          {result.invalidPhones} · Omitidos: {result.skipped}
        </p>
      )}
    </div>
  );
}
