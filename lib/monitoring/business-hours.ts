// Horario laboral del equipo (pura, sin base): cuándo el silencio de webhooks es alerta.

/** Horario laboral en Mazatlán: lunes a sábado, 9:00–19:00. */
export function isBusinessHours(now: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Mazatlan",
    weekday: "short",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value;
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  return weekday !== "Sun" && hour >= 9 && hour < 19;
}
