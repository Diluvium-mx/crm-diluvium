import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export default async function DashboardPage() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    redirect("/sign-in");
  }

  return (
    <main className="flex min-h-full flex-1 items-center justify-center p-6">
      <div className="space-y-2 text-center">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p>Sesión activa como {session.user.email}</p>
      </div>
    </main>
  );
}
