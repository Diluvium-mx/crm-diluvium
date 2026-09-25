// "📍 Guadalajara, Jal." en texto chico gris, abajo de un teléfono (tarjeta del
// Embudo y encabezado del chat). Al pasar el cursor avisa que sale de la lada. Sin
// lógica de datos: el lugar lo da lib/phone-lada.ts. Sin teléfono o sin dato: nada.
import { phoneLocation, phoneLocationHint } from "@/lib/phone-lada";

export function PhoneLocation({ phone }: { phone: string | null | undefined }) {
  const location = phoneLocation(phone);
  if (!location) return null;
  const hint = phoneLocationHint(location);
  return (
    <span title={hint} className="block truncate text-[11px] leading-4 text-muted-foreground">
      <span aria-hidden="true">📍 </span>
      {location.label}
    </span>
  );
}
