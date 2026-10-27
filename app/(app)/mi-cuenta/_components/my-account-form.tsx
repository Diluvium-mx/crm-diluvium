"use client";

// "Mi cuenta": cualquier usuario cambia SU contraseña (pide la actual). Guía de 4 pasos y,
// antes de cambiarla, un aviso: no se deshace y se cierra su sesión en TODOS sus dispositivos,
// también en este (decisión del dueño, 27-oct-2026). Si sale bien, la acción lleva a «Iniciar
// sesión» con el aviso de entrar con la nueva; aquí solo regresa si falló.
import { useState } from "react";
import { unstable_rethrow } from "next/navigation";
import { TopConfirm } from "@/components/ui/top-confirm";
import { changeMyPassword } from "@/lib/actions/team";

const inputClass =
  "w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/30";

export function MyAccountForm({ name, email }: { name: string; email: string }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);

  const mismatch = confirm.length > 0 && next !== confirm;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (next !== confirm) return;
    setError(null);
    setAsking(true);
  }

  async function changePassword() {
    setSaving(true);
    try {
      const result = await changeMyPassword({ currentPassword: current, newPassword: next });
      if (!result.ok) setError(result.message);
    } catch (caught) {
      // La redirección a «Iniciar sesión» llega como error de Next: se deja pasar.
      unstable_rethrow(caught);
      setError("No se pudo cambiar la contraseña.");
    }
    setSaving(false);
    setAsking(false);
  }

  return (
    <div className="max-w-md space-y-4">
      <div className="rounded-lg border bg-card p-4 text-sm">
        <p className="font-medium">{name}</p>
        <p className="text-muted-foreground">{email}</p>
      </div>
      <form onSubmit={submit} className="space-y-3 rounded-lg border bg-card p-4">
        <h2 className="text-sm font-semibold">Cambiar mi contraseña</h2>
        <div className="space-y-1 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">Cómo se hace:</p>
          <ol className="list-decimal space-y-0.5 pl-4">
            <li>Escribe tu contraseña actual.</li>
            <li>Escribe la nueva dos veces (mínimo 12 caracteres).</li>
            <li>Confirma el aviso: se cierra tu sesión en todos tus dispositivos, también en este.</li>
            <li>Entra otra vez con tu correo y la contraseña nueva.</li>
          </ol>
        </div>
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
        {error && <p className="text-xs text-brand-orange">{error}</p>}
        <button
          type="submit"
          disabled={asking || mismatch || !current || next.length < 12}
          className="rounded-md bg-brand-navy px-4 py-2 text-sm font-medium text-brand-white hover:bg-brand-navy-dark disabled:opacity-50"
        >
          Cambiar contraseña
        </button>
      </form>
      {asking && (
        <TopConfirm
          title="¿Cambiar tu contraseña?"
          confirmLabel="Cambiar y salir"
          pendingLabel="Cambiando…"
          pending={saving}
          onConfirm={() => void changePassword()}
          onCancel={() => setAsking(false)}
        >
          No se puede deshacer: la contraseña anterior deja de servir. Se cerrará tu sesión aquí y en todos tus dispositivos
          (computadora y celular). Después entra de nuevo con tu correo y la contraseña nueva.
        </TopConfirm>
      )}
    </div>
  );
}
