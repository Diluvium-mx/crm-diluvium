"use client";

// Menú del usuario, abajo del sidebar (todos los roles): quién está dentro, "Mi
// cuenta" (nombre y cambiar la propia contraseña) y "Cerrar sesión". "Mi cuenta"
// salió de Configuración (25-sep-2026), que ahora es solo de owner/admin. "Cerrar sesión"
// pide confirmar con el globo pegado al botón del usuario (sign-out-confirm.tsx, 1-oct-2026).
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronUp, LogOut, UserRound } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SignOutConfirm } from "./sign-out-confirm";

function initials(name: string, email: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length ? words.slice(0, 2).map((w) => w[0]) : [email[0] ?? "?"];
  return letters.join("").toUpperCase();
}

export function UserMenu({ name, email, roleLabel }: { name: string; email: string; roleLabel: string }) {
  const router = useRouter();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          ref={triggerRef}
          data-glow="light"
          className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm text-brand-white/90 transition-colors hover:bg-white/[0.06] hover:text-white data-popup-open:bg-white/10"
        >
          <span
            aria-hidden="true"
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/15 text-xs font-semibold text-white"
          >
            {initials(name, email)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{name || email}</span>
            <span className="block truncate text-xs text-brand-white/70">{roleLabel}</span>
          </span>
          <ChevronUp className="size-4 shrink-0 opacity-70" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-52">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="truncate">{email}</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => router.push("/mi-cuenta")}>
              <UserRound aria-hidden="true" />
              Mi cuenta
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setConfirmOpen(true)}>
              <LogOut aria-hidden="true" />
              Cerrar sesión
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <SignOutConfirm open={confirmOpen} onOpenChange={setConfirmOpen} anchor={triggerRef} side="top" align="start" />
    </>
  );
}
