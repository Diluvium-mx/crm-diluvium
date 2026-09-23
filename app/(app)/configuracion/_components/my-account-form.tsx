"use client";

// "Mi cuenta": cualquier usuario cambia SU contraseña (pide la actual). Al
// cambiarla se cierran sus otras sesiones.
import { useState } from "react";
import { changeMyPassword } from "@/lib/actions/team";

const inputClass =
  "w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/30";

export function MyAccountForm({ name, email }: { name: string; email: string }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const mismatch = confirm.length > 0 && next !== confirm;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (mismatch) return;
    setSaving(true);
    setMessage(null);
    try {
      const result = await changeMyPassword({ currentPassword: current, newPassword: next });
      if (result.ok) {
        setCurrent("");
        setNext("");
        setConfirm("");
        setMessage({ ok: true, text: "Contraseña actualizada. Se cerraron tus sesiones en otros dispositivos." });
      } else {
        setMessage({ ok: false, text: result.message });
      }
    } catch {
      setMessage({ ok: false, text: "No se pudo cambiar la contraseña." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-md space-y-4">
      <div className="rounded-lg border bg-card p-4 text-sm">
        <p className="font-medium">{name}</p>
        <p className="text-muted-foreground">{email}</p>
      </div>
      <form onSubmit={submit} className="space-y-3 rounded-lg border bg-card p-4">
        <h2 className="text-sm font-semibold">Cambiar mi contraseña</h2>
        <label className="block space-y-1 text-xs">
          <span className="text-muted-foreground">Contraseña actual</span>
          <input type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} className={inputClass} />
        </label>
        <label className="block space-y-1 text-xs">
          <span className="text-muted-foreground">Nueva contraseña (mínimo 12 caracteres)</span>
          <input type="password" autoComplete="new-password" required minLength={12} value={next} onChange={(e) => setNext(e.target.value)} className={inputClass} />
        </label>
        <label className="block space-y-1 text-xs">
          <span className="text-muted-foreground">Confirma la nueva contraseña</span>
          <input type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputClass} />
        </label>
        {mismatch && <p className="text-xs text-brand-orange">Las contraseñas no coinciden.</p>}
        {message && <p className={`text-xs ${message.ok ? "text-emerald-700 dark:text-emerald-300" : "text-brand-orange"}`}>{message.text}</p>}
        <button
          type="submit"
          disabled={saving || mismatch || !current || next.length < 12}
          className="rounded-md bg-brand-navy px-4 py-2 text-sm font-medium text-brand-white hover:bg-brand-navy-dark disabled:opacity-50"
        >
          {saving ? "Guardando…" : "Cambiar contraseña"}
        </button>
      </form>
    </div>
  );
}
