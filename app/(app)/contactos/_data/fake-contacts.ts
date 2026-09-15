import { STAGES, type Contact, type Stage } from "./types";

// PRNG con semilla fija (no Math.random): los datos falsos deben verse
// idénticos en el render de servidor y en la hidratación del cliente,
// o React marca mismatch de hidratación.
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST_NAMES = [
  "María",
  "José",
  "Juan",
  "Guadalupe",
  "Alejandro",
  "Fernanda",
  "Luis",
  "Ana",
  "Carlos",
  "Daniela",
  "Miguel",
  "Sofía",
  "Jorge",
  "Valeria",
  "Ricardo",
  "Camila",
  "Javier",
  "Paola",
  "Roberto",
  "Ximena",
] as const;

const LAST_NAMES = [
  "García",
  "Hernández",
  "Martínez",
  "López",
  "González",
  "Pérez",
  "Rodríguez",
  "Sánchez",
  "Ramírez",
  "Flores",
  "Torres",
  "Vázquez",
  "Gómez",
  "Ruiz",
  "Díaz",
  "Morales",
  "Reyes",
  "Cruz",
  "Ortiz",
  "Mendoza",
] as const;

const COMPANIES = [
  "Grupo Bimbo",
  "Cemex",
  "Femsa",
  "Soriana",
  "Elektra",
  "Bodega Aurrera",
  "Coppel",
  "Liverpool",
  "Interceramic",
  "Grupo Salinas",
  "Chedraui",
  "Farmacias del Ahorro",
  "OXXO",
  "Banorte",
  "Vitro",
] as const;

const AREA_CODES = ["55", "33", "81", "656", "998", "999", "442", "477", "222", "614"] as const;

const EMAIL_DOMAINS = ["gmail.com", "hotmail.com", "outlook.com"] as const;

const STAGE_COUNTS: Record<Stage, number> = {
  Inbox: 10,
  Prospecto: 8,
  Interesado: 7,
  "Cerca de compra": 5,
  Compra: 4,
};

function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function slugify(value: string): string {
  return stripDiacritics(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function pick<T>(items: readonly T[], rng: () => number): T {
  return items[Math.floor(rng() * items.length)];
}

function randomInt(min: number, max: number, rng: () => number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

export function generateFakeContacts(): Contact[] {
  const rng = mulberry32(20260101);
  const contacts: Contact[] = [];
  let counter = 0;

  for (const stage of STAGES) {
    const stageIndex = STAGES.indexOf(stage);

    for (let i = 0; i < STAGE_COUNTS[stage]; i++) {
      counter += 1;

      const firstName = pick(FIRST_NAMES, rng);
      const lastName = pick(LAST_NAMES, rng);
      const secondLastName = pick(LAST_NAMES, rng);
      const name = `${firstName} ${lastName} ${secondLastName}`;

      const areaCode = pick(AREA_CODES, rng);
      const phone = `+52 ${areaCode} ${randomInt(100, 999, rng)} ${randomInt(1000, 9999, rng)}`;

      const company = pick(COMPANIES, rng);
      const emailLocal = `${slugify(firstName)}.${slugify(lastName)}`;
      const email =
        rng() > 0.5
          ? `${emailLocal}@${slugify(company)}.com.mx`
          : `${emailLocal}@${pick(EMAIL_DOMAINS, rng)}`;

      const valueCents = randomInt(5_000, 40_000, rng) * (stageIndex + 1) * 100;

      contacts.push({
        id: `contact-${counter}`,
        name,
        phone,
        email,
        company,
        stage,
        valueCents,
      });
    }
  }

  return contacts;
}
