// Reglas de CUÁNDO alerta cada cosa (puras, sin base). El silencio de mensajes
// entrantes solo alerta en horario laboral (de noche es normal que nadie
// escriba); la desconexión del número alerta a cualquier hora
// (accountProblems en ./zernio-account.ts no mira el reloj).
import { isBusinessHours } from "./business-hours";

export function silenceProblem(input: {
  now: Date;
  minutesSinceLastEvent: number | null;
  silenceMinutes: number;
}): string | null {
  if (!isBusinessHours(input.now)) return null;
  if (input.minutesSinceLastEvent !== null && input.minutesSinceLastEvent <= input.silenceMinutes) return null;
  return `sin mensajes entrantes de WhatsApp hace más de ${input.silenceMinutes} min en horario laboral`;
}
