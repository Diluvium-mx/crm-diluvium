export const STAGES = [
  "Inbox",
  "Prospecto",
  "Interesado",
  "Cerca de compra",
  "Compra",
] as const;

export type Stage = (typeof STAGES)[number];

export interface Contact {
  id: string;
  name: string;
  phone: string;
  email: string;
  company: string;
  stage: Stage;
  valueCents: number;
}
