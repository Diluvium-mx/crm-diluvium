"use server";
// Franja de la Bandeja por envíos que fallan en serie (P4, 22-oct-2026): la recarga cada 2 min
// la franja ya abierta (app/(app)/dashboard/_components/send-failures-banner.tsx). Solo lee.
import { requireActiveMembership } from "@/lib/auth/active-organization";
import { recentSendFailures, sendFailureBannerLines } from "@/lib/monitoring/send-failures";

export async function loadSendFailureLines(): Promise<string[]> {
  const { organizationId } = await requireActiveMembership();
  return sendFailureBannerLines(await recentSendFailures({ organizationId }));
}
