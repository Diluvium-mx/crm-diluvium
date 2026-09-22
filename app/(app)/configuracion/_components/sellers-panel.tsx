"use client";

// "Vendedores" (solo owner/admin): lista, alta, cambio de rol, restablecer
// contraseña y desactivar/reactivar. La UI esconde lo que el usuario no puede
// hacer con las MISMAS reglas que la server action (lib/team/rules.ts); el
// servidor las vuelve a exigir y la BD garantiza el owner activo.
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  addSeller,
  changeSellerRole,
  deactivateSeller,
  reactivateSeller,
  resetSellerPassword,
  type TeamResult,
} from "@/lib/actions/team";
import { assignableRoles, isTeamRole, ROLE_LABELS, teamActionError, type TeamRole } from "@/lib/team/rules";
import type { TeamMember } from "@/lib/team/store";

const inputClass =
  "w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/30";

function roleLabel(role: string): string {
  return isTeamRole(role) ? ROLE_LABELS[role] : role;
}

export function SellersPanel({ members, me, myRole }: { members: TeamMember[]; me: string; myRole: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "agent" as TeamRole });

  const actor = { userId: me, role: myRole };
  const activeOwners = members.filter((m) => m.role.split(",").includes("owner") && !m.banned).length;
  const roles = assignableRoles(myRole);

  async function act(action: () => Promise<TeamResult>, success: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await action();
      if (!result.ok) {
        setError(result.message);
        return false;
      }
      setNotice(success);
      router.refresh();
      return true;
    } catch {
      setError("No se pudo completar la operación.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {(error || notice) && (
        <p className={`text-sm ${error ? "text-brand-orange" : "text-emerald-700 dark:text-emerald-300"}`}>{error ?? notice}</p>
      )}

      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Nombre</th>
              <th className="px-3 py-2 font-medium">Correo</th>
              <th className="px-3 py-2 font-medium">Rol</th>
              <th className="px-3 py-2 font-medium">Estado</th>
              <th className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const can = (type: "reset_password" | "deactivate" | "reactivate") =>
                teamActionError(actor, m, { type }, activeOwners) === null;
              const roleOptions = roles.filter(
                (r) => r === m.role || teamActionError(actor, m, { type: "change_role", newRole: r }, activeOwners) === null,
              );
              const canChangeRole = roleOptions.some((r) => r !== m.role);
              return (
                <tr key={m.memberId} className="border-b last:border-0 align-top">
                  <td className="px-3 py-2">
                    {m.name}
                    {m.userId === me && <span className="ml-1 text-xs text-muted-foreground">(tú)</span>}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{m.email}</td>
                  <td className="px-3 py-2">
                    {canChangeRole ? (
                      <select
                        value={m.role}
                        disabled={busy}
                        aria-label={`Rol de ${m.name}`}
                        onChange={(e) => void act(() => changeSellerRole(m.memberId, e.target.value), "Rol actualizado.")}
                        className="rounded border bg-background px-2 py-1 text-sm"
                      >
                        {roleOptions.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      roleLabel(m.role)
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {m.banned ? <span className="text-muted-foreground">Desactivado</span> : "Activo"}
                  </td>
                  <td className="space-x-1 whitespace-nowrap px-3 py-2 text-right">
                    {can("reset_password") && (
                      <button type="button" disabled={busy} onClick={() => { setResettingId(m.memberId); setNewPassword(""); }} className="rounded px-2 py-1 text-xs text-brand-navy hover:bg-brand-navy/10 dark:text-sky-300">
                        Restablecer contraseña
                      </button>
                    )}
                    {!m.banned && can("deactivate") && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          if (window.confirm(`¿Desactivar a ${m.name}? No podrá entrar y se cerrarán sus sesiones. Sus mensajes se conservan.`)) {
                            void act(() => deactivateSeller(m.memberId), `${m.name} quedó desactivado.`);
                          }
                        }}
                        className="rounded px-2 py-1 text-xs text-brand-orange hover:bg-brand-orange/10"
                      >
                        Desactivar
                      </button>
                    )}
                    {m.banned && can("reactivate") && (
                      <button type="button" disabled={busy} onClick={() => void act(() => reactivateSeller(m.memberId), `${m.name} quedó activo.`)} className="rounded px-2 py-1 text-xs text-brand-navy hover:bg-brand-navy/10 dark:text-sky-300">
                        Reactivar
                      </button>
                    )}
                    {resettingId === m.memberId && (
                      <form
                        className="mt-2 flex items-center justify-end gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void act(() => resetSellerPassword(m.memberId, newPassword), `Contraseña de ${m.name} restablecida. Se cerraron sus sesiones.`).then((ok) => {
                            if (!ok) return;
                            setResettingId(null);
                            setNewPassword("");
                          });
                        }}
                      >
                        <input
                          type="password"
                          autoComplete="new-password"
                          minLength={12}
                          required
                          placeholder="Nueva contraseña (12+)"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          className="w-48 rounded-md border bg-background px-2 py-1 text-xs"
                        />
                        <button type="submit" disabled={busy || newPassword.length < 12} className="rounded-md bg-brand-navy px-2 py-1 text-xs text-brand-white disabled:opacity-50">
                          Guardar
                        </button>
                        <button type="button" onClick={() => setResettingId(null)} className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted">
                          Cancelar
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <form
        className="grid max-w-3xl gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void act(() => addSeller(form), `${form.name} agregado. Comparte su contraseña inicial por un medio seguro.`).then((ok) => {
            if (ok) setForm({ name: "", email: "", password: "", role: "agent" });
          });
        }}
      >
        <h2 className="text-sm font-semibold sm:col-span-2">Agregar vendedor</h2>
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">Nombre</span>
          <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} />
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">Correo</span>
          <input type="email" required autoComplete="off" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputClass} />
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">Contraseña inicial (mínimo 12)</span>
          <input type="password" required minLength={12} autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className={inputClass} />
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">Rol</span>
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as TeamRole })} className={inputClass}>
            {roles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
        <div className="sm:col-span-2">
          <button type="submit" disabled={busy || form.password.length < 12} className="rounded-md bg-brand-orange px-4 py-2 text-sm font-medium text-brand-white hover:bg-brand-orange-light disabled:opacity-50">
            Agregar
          </button>
        </div>
      </form>
    </div>
  );
}
