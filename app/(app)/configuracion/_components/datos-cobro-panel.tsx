"use client";

// "Datos de cobro" (Fase D): banco, beneficiario, CLABE, cuenta, concepto y
// notas. Owner/admin editan; el vendedor los ve con la CLABE enmascarada. En la
// parte (b) el agente coteja el destinatario del comprobante contra esto.
import { useState } from "react";
import { saveDatosCobro, type DatosCobroView } from "@/lib/actions/datos-cobro";
import { clabeChecksumOk } from "@/lib/cobro/datos-cobro";

const input = "w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-brand-orange focus:ring-2 focus:ring-brand-orange/30";

export function DatosCobroPanel({ initial }: { initial: DatosCobroView }) {
  const [form, setForm] = useState({
    banco: initial.banco,
    beneficiario: initial.beneficiario,
    clabe: initial.clabe,
    cuenta: initial.cuenta,
    concepto: initial.concepto,
    notas: initial.notas,
  });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });
  const clabeClean = form.clabe.replace(/\s+/g, "");
  const clabeBad = clabeClean !== "" && !clabeChecksumOk(clabeClean);

  async function save() {
    setBusy(true);
    setNotice(null);
    const r = await saveDatosCobro(form);
    setBusy(false);
    setNotice(r.ok ? { ok: true, text: "Datos de cobro guardados." } : { ok: false, text: r.error });
  }

  if (!initial.canEdit) {
    return (
      <div className="space-y-2 rounded-lg border bg-card p-4 text-sm shadow-sm">
        <p className="text-muted-foreground">Para cotejar depósitos. Solo owner/admin los editan.</p>
        <Row label="Banco" value={initial.banco} />
        <Row label="Beneficiario" value={initial.beneficiario} />
        <Row label="CLABE" value={initial.clabeMasked || "—"} />
        <Row label="Cuenta" value={initial.cuenta} />
        <Row label="Concepto" value={initial.concepto} />
        {initial.notas && <Row label="Notas" value={initial.notas} />}
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4 shadow-sm">
      <p className="text-sm text-muted-foreground">
        Lo que aparece en la imagen de “Datos bancarios”, en texto. El Agente IA usará el beneficiario y la CLABE para cotejar un comprobante antes de confirmar un pago; el vendedor los ve con la CLABE enmascarada.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Banco</span>
          <input value={form.banco} onChange={set("banco")} maxLength={60} className={input} />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Beneficiario (titular de la cuenta)</span>
          <input value={form.beneficiario} onChange={set("beneficiario")} maxLength={120} className={input} />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">CLABE (18 dígitos)</span>
          <input value={form.clabe} onChange={set("clabe")} inputMode="numeric" maxLength={24} className={`${input} ${clabeBad ? "border-red-400" : ""}`} />
          {clabeBad && <span className="text-xs text-red-600">La CLABE no cuadra (18 dígitos con dígito verificador).</span>}
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Cuenta o tarjeta (opcional)</span>
          <input value={form.cuenta} onChange={set("cuenta")} maxLength={40} className={input} />
        </label>
        <label className="space-y-1 sm:col-span-2">
          <span className="text-xs font-medium text-muted-foreground">Concepto que se pide al cliente</span>
          <input value={form.concepto} onChange={set("concepto")} maxLength={120} className={input} placeholder="p. ej. nombre y tamaño de la compuerta" />
        </label>
        <label className="space-y-1 sm:col-span-2">
          <span className="text-xs font-medium text-muted-foreground">Notas para el equipo (anticipos, condiciones)</span>
          <textarea value={form.notas} onChange={set("notas")} rows={3} maxLength={1000} className={input} />
        </label>
      </div>
      {notice && <p className={`text-sm ${notice.ok ? "text-green-700" : "text-red-600"}`}>{notice.text}</p>}
      <div className="flex justify-end">
        <button type="button" onClick={() => void save()} disabled={busy || clabeBad} className="rounded-md bg-brand-orange px-3 py-2 text-sm font-medium text-brand-white hover:bg-brand-orange-light disabled:opacity-60">
          {busy ? "Guardando…" : "Guardar"}
        </button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <p>
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}: </span>
      <span>{value || "—"}</span>
    </p>
  );
}
