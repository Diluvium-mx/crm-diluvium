// Composer de un canal ARCHIVADO (docs/numero-prueba.md, paso 8): el historial se
// sigue viendo, pero desde ese número ya no se envía nada.
export function ArchivedComposer() {
  return (
    <div className="shrink-0 border-t bg-card px-4 py-3">
      <textarea
        disabled
        rows={1}
        aria-label="Canal archivado"
        placeholder="Canal archivado"
        className="w-full cursor-not-allowed resize-none rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground"
      />
      <p className="mt-1 text-center text-[11px] text-muted-foreground">
        Este número ya no está conectado: el historial queda para consulta y no se puede escribir.
      </p>
    </div>
  );
}
