"use client";

// Menú del usuario, abajo del sidebar (todos los roles): quién está dentro, "Mi
// cuenta" (nombre y cambiar la propia contraseña) y "Cerrar sesión". "Mi cuenta"
// salió de Configuración (25-sep-2026), que ahora es solo de owner/admin.
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
import { signOut } from "@/lib/auth/client";

function initials(name: string, email: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length ? words.slice(0, 2).map((w) => w[0]) : [email[0] ?? "?"];
  return letters.join("").toUpperCase();
}

export function UserMenu({ name, email, roleLabel }: { name: string; email: string; roleLabel: string }) {
  const router = useRouter();

  async function handleSignOut() {
    try {
      await signOut();
    } finally {
      router.push("/sign-in");
      router.refresh();
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
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
          <DropdownMenuItem onClick={() => void handleSignOut()}>
            <LogOut aria-hidden="true" />
            Cerrar sesión
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
