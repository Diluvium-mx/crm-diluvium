"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "@/lib/auth/client";

export function SignOutButton() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSignOut() {
    setIsSubmitting(true);

    try {
      await signOut();
    } finally {
      setIsSubmitting(false);
      router.push("/sign-in");
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={isSubmitting}
      className="rounded border border-white/30 px-3 py-1.5 text-sm text-white transition-colors hover:bg-white/10 disabled:opacity-50"
    >
      {isSubmitting ? "Saliendo..." : "Cerrar sesión"}
    </button>
  );
}
