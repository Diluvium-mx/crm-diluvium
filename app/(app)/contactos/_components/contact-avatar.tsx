import { User } from "lucide-react";
import type { Contact } from "../_data/types";

// Iniciales del contacto ignorando emojis/símbolos al inicio: toma la primera
// LETRA real de nombre y apellido. Si el nombre no tiene ninguna letra (p.ej.
// empieza y es solo emoji), devuelve null y el avatar cae a un ícono de persona.
function firstLetter(value: string | null | undefined): string {
  return value?.match(/\p{L}/u)?.[0] ?? "";
}

function getInitials(contact: Contact): string | null {
  const initials = (firstLetter(contact.firstName) + firstLetter(contact.lastName)).toUpperCase();
  return initials || null;
}

// Íconos de canal inline (sin archivos aparte), a todo color y con la forma
// propia de cada marca: WhatsApp y Facebook en círculo, Instagram en cuadrado.
function WhatsAppGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
    </svg>
  );
}

function FacebookGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M15.12 5.32H17V2.14A26.11 26.11 0 0 0 14.26 2c-2.72 0-4.58 1.66-4.58 4.7v2.6H6.61v3.56h3.07V22h3.68v-9.14h3.06l.46-3.56h-3.52V7.05c0-1.03.28-1.73 1.76-1.73z" />
    </svg>
  );
}

function InstagramGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.43.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.43.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41a3.7 3.7 0 0 1-1.38-.9 3.7 3.7 0 0 1-.9-1.38c-.16-.43-.36-1.06-.41-2.23C2.17 15.58 2.16 15.2 2.16 12s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.43-.16 1.06-.36 2.23-.41C8.42 2.17 8.8 2.16 12 2.16zM12 0C8.74 0 8.33.01 7.05.07 5.78.13 4.9.33 4.14.63c-.79.3-1.46.72-2.13 1.38C1.35 2.68.93 3.35.63 4.14.33 4.9.13 5.78.07 7.05.01 8.33 0 8.74 0 12s.01 3.67.07 4.95c.06 1.27.26 2.15.56 2.91.3.79.72 1.46 1.38 2.13.67.66 1.34 1.08 2.13 1.38.76.3 1.64.5 2.91.56C8.33 23.99 8.74 24 12 24s3.67-.01 4.95-.07c1.27-.06 2.15-.26 2.91-.56a5.9 5.9 0 0 0 2.13-1.38 5.9 5.9 0 0 0 1.38-2.13c.3-.76.5-1.64.56-2.91.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.06-1.27-.26-2.15-.56-2.91a5.9 5.9 0 0 0-1.38-2.13A5.9 5.9 0 0 0 19.86.63c-.76-.3-1.64-.5-2.91-.56C15.67.01 15.26 0 12 0zm0 5.84a6.16 6.16 0 1 0 0 12.32 6.16 6.16 0 0 0 0-12.32zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.41-11.85a1.44 1.44 0 1 0 0 2.88 1.44 1.44 0 0 0 0-2.88z" />
    </svg>
  );
}

// Badge del canal, abajo-derecha del avatar. Anillo del color de la tarjeta
// para recortarlo limpio en ambos temas.
function ChannelBadge({ channel }: { channel: string | null }) {
  const ring = "ring-2 ring-card";
  if (channel === "whatsapp") {
    return (
      <span
        className={`absolute -bottom-0.5 -right-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[#25D366] ${ring}`}
        title="WhatsApp"
      >
        <WhatsAppGlyph className="h-3 w-3 text-white" />
      </span>
    );
  }
  if (channel === "fb") {
    return (
      <span
        className={`absolute -bottom-0.5 -right-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[#1877F2] ${ring}`}
        title="Facebook"
      >
        <FacebookGlyph className="h-3 w-3 text-white" />
      </span>
    );
  }
  if (channel === "instagram") {
    return (
      <span
        className={`absolute -bottom-0.5 -right-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-[5px] bg-gradient-to-br from-[#FEDA75] via-[#D62976] to-[#4F5BD5] ${ring}`}
        title="Instagram"
      >
        <InstagramGlyph className="h-3 w-3 text-white" />
      </span>
    );
  }
  // Canal desconocido: círculo blanco con contorno verde.
  return (
    <span
      className={`absolute -bottom-0.5 -right-0.5 h-[18px] w-[18px] rounded-full border-2 border-[#25D366] bg-white ${ring}`}
      title="Canal desconocido"
    />
  );
}

export function ContactAvatar({ contact }: { contact: Contact }) {
  const initials = getInitials(contact);
  return (
    <div className="relative shrink-0">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-navy text-sm font-medium text-brand-white">
        {initials ?? <User className="h-5 w-5" aria-hidden="true" />}
      </div>
      <ChannelBadge channel={contact.sourceChannel} />
    </div>
  );
}
