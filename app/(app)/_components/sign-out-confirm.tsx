"use client";

// Confirmación de «Cerrar sesión» (1-oct-2026, opción C del prototipo del dueño en
// notas/barra-superior): un globo pegado al botón que se tocó —el de la barra de arriba o el
// menú del usuario (sidebar y cajón ☰)—. «Cancelar» queda enfocado (un Enter no saca a nadie por
// error); Esc o clic fuera cancelan. Solo «Cerrar sesión» sale del CRM. Sin lógica de datos más
// allá de salir.
import { useRef, useState, type ReactElement, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { Popover } from "@base-ui/react/popover";
import { signOut } from "@/lib/auth/client";

export function SignOutConfirm({
  open,
  onOpenChange,
  trigger,
  anchor,
  side = "bottom",
  align = "end",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // El botón que abre el globo (barra de arriba). Sin él, el globo sale pegado a `anchor`.
  trigger?: ReactElement;
  anchor?: RefObject<HTMLElement | null>;
  side?: "top" | "bottom";
  align?: "start" | "end";
}) {
  const router = useRouter();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [leaving, setLeaving] = useState(false);

  async function handleSignOut() {
    setLeaving(true);
    try {
      await signOut();
    } finally {
      router.push("/sign-in");
      router.refresh();
    }
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        // Mientras sale, el globo se queda («Saliendo…») hasta que cambie la página.
        if (!leaving) onOpenChange(next);
      }}
    >
      {trigger && <Popover.Trigger render={trigger} />}
      <Popover.Portal>
        <Popover.Positioner
          anchor={anchor}
          side={side}
          align={align}
          sideOffset={10}
          collisionPadding={12}
          className="isolate z-50 outline-none"
        >
          <Popover.Popup
            initialFocus={cancelRef}
            className="w-68 origin-(--transform-origin) rounded-lg border bg-popover p-3.5 text-popover-foreground shadow-lg outline-none duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
          >
            <Popover.Arrow className="size-3 rotate-45 border-border bg-popover data-[side=bottom]:-top-1.5 data-[side=bottom]:border-t data-[side=bottom]:border-l data-[side=top]:-bottom-1.5 data-[side=top]:border-r data-[side=top]:border-b" />
            <Popover.Title className="text-[15px] font-semibold">¿Cerrar sesión?</Popover.Title>
            <Popover.Description className="mt-1 text-[13px] text-muted-foreground">
              Saldrás del CRM en esta computadora.
            </Popover.Description>
            <div className="mt-3 flex justify-end gap-2">
              <Popover.Close
                ref={cancelRef}
                disabled={leaving}
                className="rounded border border-black/15 px-3 py-1.5 text-sm text-foreground disabled:opacity-50 dark:border-white/15"
              >
                Cancelar
              </Popover.Close>
              <button
                type="button"
                onClick={() => void handleSignOut()}
                disabled={leaving}
                className="rounded bg-brand-orange px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
              >
                {leaving ? "Saliendo…" : "Cerrar sesión"}
              </button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
