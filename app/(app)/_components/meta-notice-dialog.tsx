"use client";

// Aviso GRANDE (pop-up) cuando WhatsApp (Meta) no acepta o frena algo de una
// plantilla: título, quién decide (Meta, no el CRM), por qué pasó y qué hacer.
// Decisión del dueño (28-sep-2026): toda falla por la revisión de Meta se avisa así,
// no como una línea chica. Textos en lib/templates/meta-reasons.ts.
import { TriangleAlert } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { META_CONTEXT, type MetaNotice } from "@/lib/templates/meta-reasons";

export function MetaNoticeDialog({ notice, onClose }: { notice: MetaNotice | null; onClose: () => void }) {
  return (
    <Dialog open={notice !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="gap-0 p-0 sm:max-w-lg" showCloseButton={false}>
        {notice && (
          <>
            <div className="flex items-start gap-3 rounded-t-xl border-b border-brand-orange/30 bg-brand-orange/10 px-5 py-4">
              <TriangleAlert className="mt-0.5 size-7 shrink-0 text-brand-orange" aria-hidden="true" />
              <div className="min-w-0 space-y-1">
                <DialogTitle className="text-base font-semibold leading-snug">{notice.title}</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">{META_CONTEXT}</DialogDescription>
              </div>
            </div>
            <div className="space-y-4 px-5 py-4 text-sm">
              <section className="space-y-1">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Por qué pasó</h3>
                <p className="break-words">{notice.why}</p>
              </section>
              <section className="space-y-1">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Qué hacer</h3>
                <ul className="list-disc space-y-1 pl-5">
                  {notice.whatToDo.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ul>
              </section>
            </div>
            <div className="flex justify-end border-t px-5 py-3">
              <button
                type="button"
                onClick={onClose}
                autoFocus
                className="rounded-md bg-brand-navy px-4 py-2 text-sm font-medium text-brand-white hover:bg-brand-navy-dark"
              >
                Entendido
              </button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
