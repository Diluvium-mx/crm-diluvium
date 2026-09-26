import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { MyAccountForm } from "./_components/my-account-form";

// "Mi cuenta" (todos los roles): nombre y cambiar la propia contraseña. Se abre
// desde el menú del usuario, abajo del sidebar (antes era una pestaña de
// Configuración, que ahora es solo de owner/admin).
export default async function MiCuentaPage() {
  await requireActiveMembership();
  const session = await auth.api.getSession({ headers: await headers() });

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4">
      <h1 className="text-lg font-semibold">Mi cuenta</h1>
      <MyAccountForm name={session?.user.name ?? ""} email={session?.user.email ?? ""} />
    </div>
  );
}
