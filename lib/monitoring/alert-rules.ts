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

// "No se pudo revisar" (Zernio no contestó al revisar la cuenta o el webhook) solo es
// alerta tras 2 revisiones SEGUIDAS fallidas del mismo vigilante (Bloque C, 28-sep): una
// falla suelta de Zernio no abre ni comenta el issue. Una desconexión real (rojo) NO
// pasa por aquí: sigue avisando de inmediato.
export const UNCHECKED_ALERT_AFTER = 2;

export function uncheckedAlert(problem: string | null, streak: number): { problem: string | null; notice: string | null } {
  if (!problem) return { problem: null, notice: null };
  if (streak >= UNCHECKED_ALERT_AFTER) return { problem: `${problem} (${streak} revisiones seguidas)`, notice: null };
  return { problem: null, notice: `${problem} (1.ª vez: se avisa si se repite en la siguiente revisión)` };
}
