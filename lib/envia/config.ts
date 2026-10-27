// Envia.com (guías de envío, 27-oct-2026; docs/envios.md). Único servicio nuevo del CRM para envíos
// (OK del dueño del 26-oct). Variables de Railway, nunca en el repo:
// - ENVIA_API_TOKEN: token de «Desarrolladores › Acceso de API» (no caduca y no se puede limitar:
//   cualquier token puede gastar saldo).
// - ENVIA_ENV: "sandbox" (staging: cuenta de pruebas aparte, guías falsas sin costo) o "production".
//   Un token de pruebas no sirve en producción ni al revés.
// - ENVIA_GENERAR: candado del saldo (27-oct-2026, pedido del dueño: «no gastes ni un peso»). Con la cuenta real
//   (production) solo se generan guías si vale «si»; sin él, el servidor solo lee y cotiza (eso no cobra). Staging
//   usa la cuenta real sin el candado abierto; producción lo abre en el OK MAIN. La de pruebas siempre genera.
// URLs de docs.envia.com/docs/production-checklist (revisado el 26-oct-2026). Geocodes solo existe en
// producción y no pide token.
export type EnviaEnv = "sandbox" | "production";

export type EnviaConfig = {
  env: EnviaEnv;
  token: string;
  /** ¿Puede generar guías (gastar saldo)? Pruebas: sí; cuenta real: solo con ENVIA_GENERAR=si. */
  canGenerate: boolean;
  shipUrl: string;
  queriesUrl: string;
  geocodesUrl: string;
};

export const ENVIA_URLS: Record<EnviaEnv, Pick<EnviaConfig, "shipUrl" | "queriesUrl" | "geocodesUrl">> = {
  sandbox: {
    shipUrl: "https://api-test.envia.com",
    queriesUrl: "https://queries.test.envia.com",
    geocodesUrl: "https://geocodes.envia.com",
  },
  production: {
    shipUrl: "https://api.envia.com",
    queriesUrl: "https://queries.envia.com",
    geocodesUrl: "https://geocodes.envia.com",
  },
};

export class EnviaNotConfiguredError extends Error {
  constructor() {
    super("Envia no está configurado en este servidor (falta ENVIA_API_TOKEN o ENVIA_ENV).");
  }
}

/** La configuración de Envia, o null si falta el token o el ambiente (la sección lo dice y no deja cotizar). */
export function enviaConfigFrom(env: Record<string, string | undefined>): EnviaConfig | null {
  const token = env.ENVIA_API_TOKEN?.trim();
  const which = env.ENVIA_ENV?.trim();
  if (!token || (which !== "sandbox" && which !== "production")) return null;
  const canGenerate = which === "sandbox" || env.ENVIA_GENERAR?.trim().toLowerCase() === "si";
  return { env: which, token, canGenerate, ...ENVIA_URLS[which] };
}

export function requireEnviaConfig(): EnviaConfig {
  const config = enviaConfigFrom(process.env);
  if (!config) throw new EnviaNotConfiguredError();
  return config;
}
