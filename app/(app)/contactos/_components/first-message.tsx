"use client";

// Contacto SIN chat (alta a mano o importado de GHL): cómo escribirle primero
// (28-sep-2026). Dos caminos, lado a lado:
// - WhatsApp Web (gratis): abre su chat con el texto ya puesto; el vendedor da
//   Enviar. Con coexistencia no hay ventana de 24 h ni plantilla, y la copia del
//   mensaje llega al CRM sola y crea el chat.
// - Plantilla desde el CRM: la única forma de escribirle por la API a quien no ha
//   escrito en 24 h (regla de Meta). Después, en el CRM solo se escribe libre
//   cuando el cliente conteste.
import { useState } from "react";
import { MetaNoticeDialog } from "@/app/(app)/_components/meta-notice-dialog";
import { startChatWithTemplate } from "@/lib/inbox/actions";
import { whatsappPhoneLink, whatsappWebLink } from "@/lib/contacts/whatsapp-link";
import type { MetaNotice } from "@/lib/templates/meta-reasons";
import { TemplatePicker } from "../../dashboard/_components/template-picker";

export function FirstMessage({
  contactId,
  phoneE164,
  onStarted,
  onOpenContact,
}: {
  contactId: string;
  phoneE164: string | null;
  /** Ya hay chat (se mandó la plantilla): recargar para ver el hilo. */
  onStarted: () => void;
  /** Abrir otro contacto (el que ya tiene este número). */
  onOpenContact?: (contactId: string) => void;
}) {
  const [text, setText] = useState("");
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [other, setOther] = useState<string | null>(null);
  const [notice, setNotice] = useState<MetaNotice | null>(null);

  async function sendTemplate(templateId: string, values: string[]) {
    setBusy(true);
    setError(null);
    setOther(null);
    const result = await startChatWithTemplate(contactId, templateId, values).catch(() => null);
    setBusy(false);
    if (!result) {
      setError("No se pudo mandar. Revisa tu conexión y vuelve a intentarlo.");
      return;
    }
    if (!result.ok) {
      setError(result.message);
      if (result.notice) setNotice(result.notice);
      if (result.otherContactId) setOther(result.otherContactId);
      return;
    }
    setPicking(false);
    onStarted();
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto p-5">
      <MetaNoticeDialog notice={notice} onClose={() => setNotice(null)} />
      <div className="mx-auto w-full max-w-lg space-y-4">
        <div className="text-center">
          <span className="text-3xl" role="img" aria-label="Chat">💬</span>
          <p className="text-sm font-medium">Este contacto aún no tiene chat</p>
          <p className="text-xs text-muted-foreground">
            Escríbele primero por uno de estos dos caminos. Todo lo que se hablen aparecerá aquí.
          </p>
        </div>

        {!phoneE164 ? (
          <p role="alert" className="rounded-md border border-brand-orange/40 bg-brand-orange/10 px-3 py-2 text-sm">
            ⚠ No tiene teléfono: sin él no se le puede escribir por WhatsApp.
          </p>
        ) : (
          <>
            <section className="space-y-2 rounded-lg border bg-card p-4 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Escribir desde WhatsApp Web</h3>
                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                  Gratis
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Se abre su chat con tu mensaje ya escrito y tú le das Enviar. Sin plantilla y sin límite de 24 h. El mensaje
                llega aquí solo.
              </p>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={2}
                placeholder="Mensaje (opcional). Ej.: Hola, buenas tardes. Le escribe Daniel de Diluvium."
                className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/30"
              />
              <div className="flex flex-wrap items-center gap-3">
                <a
                  href={whatsappWebLink(phoneE164, text)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-md bg-brand-navy px-4 py-2 text-sm font-medium text-brand-white hover:bg-brand-navy-dark"
                >
                  Abrir en WhatsApp Web
                </a>
                <a
                  href={whatsappPhoneLink(phoneE164, text)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-medium text-brand-navy underline-offset-2 hover:underline dark:text-sky-300"
                >
                  o en el celular
                </a>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Debe estar abierto WhatsApp Web con el número de Diluvium.
              </p>
            </section>

            <section className="space-y-2 rounded-lg border bg-card p-4 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">📄 Enviar plantilla desde el CRM</h3>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                  Con costo (Marketing ≈ $0.73)
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Sale del número de Diluvium sin abrir WhatsApp. Es un mensaje aprobado por Meta: después de mandarlo, en el
                CRM solo podrás escribir libre cuando el cliente conteste.
              </p>
              {picking ? (
                <TemplatePicker
                  submitLabel={busy ? "Enviando…" : "Enviar plantilla"}
                  busy={busy}
                  onSubmit={(templateId, values) => void sendTemplate(templateId, values)}
                  onClose={() => setPicking(false)}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setPicking(true);
                  }}
                  className="rounded-md border border-brand-navy px-4 py-2 text-sm font-medium text-brand-navy hover:bg-brand-navy/10 dark:text-sky-300"
                >
                  Elegir plantilla
                </button>
              )}
              {error && (
                <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-brand-orange/40 bg-brand-orange/10 px-3 py-2 text-xs">
                  <span>⚠ {error}</span>
                  {other && onOpenContact && (
                    <button type="button" onClick={() => onOpenContact(other)} className="font-semibold text-brand-navy underline dark:text-sky-300">
                      Abrir ese contacto
                    </button>
                  )}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
