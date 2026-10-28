// Envío del correo de costos por la API de Zoho Mail (docs/costos.md › Envío). La cuenta contacto@diluvium.com.mx
// es del plan gratis de Zoho (sin IMAP/POP) y Railway Hobby bloquea SMTP, por eso va por HTTPS con OAuth:
// un «Self Client» de Zoho con el permiso ZohoMail.messages.CREATE (solo crear/enviar) y su refresh token, que no
// caduca. Cada envío pide un access token de 1 h y manda un solo correo. Los errores nunca llevan las llaves.
export type ZohoConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  accountId: string;
  // Data center de la cuenta (com = Estados Unidos).
  accountsUrl: string;
  mailUrl: string;
};

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}>;

const VARS = ["ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REFRESH_TOKEN", "ZOHO_ACCOUNT_ID"] as const;

export function zohoConfigFromEnv(env: Record<string, string | undefined> = process.env): { config: ZohoConfig } | { faltan: string[] } {
  const faltan = VARS.filter((v) => !env[v]);
  if (faltan.length) return { faltan };
  return {
    config: {
      clientId: env.ZOHO_CLIENT_ID as string,
      clientSecret: env.ZOHO_CLIENT_SECRET as string,
      refreshToken: env.ZOHO_REFRESH_TOKEN as string,
      accountId: env.ZOHO_ACCOUNT_ID as string,
      accountsUrl: env.ZOHO_ACCOUNTS_URL || "https://accounts.zoho.com",
      mailUrl: env.ZOHO_MAIL_URL || "https://mail.zoho.com",
    },
  };
}

// Quita las llaves de cualquier texto que vaya a un error (Zoho a veces repite parámetros en sus respuestas).
export function redactZoho(text: string, config: ZohoConfig): string {
  let out = text;
  for (const secret of [config.clientSecret, config.refreshToken, config.clientId]) if (secret) out = out.split(secret).join("[llave]");
  return out.slice(0, 300);
}

function parse(text: string): Record<string, unknown> {
  try {
    const json: unknown = JSON.parse(text);
    return json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function accessToken(config: ZohoConfig, fetchImpl: FetchLike): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken,
  }).toString();
  const res = await fetchImpl(`${config.accountsUrl}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await res.text();
  const json = parse(text);
  if (!res.ok || typeof json.access_token !== "string") {
    const motivo = typeof json.error === "string" ? json.error : `HTTP ${res.status}`;
    throw new Error(`Zoho no dio acceso (${redactZoho(motivo, config)}): revisa ZOHO_REFRESH_TOKEN (docs/costos.md › Conectar Zoho).`);
  }
  return json.access_token;
}

export async function enviarCorreoZoho(
  config: ZohoConfig,
  correo: { de: string; para: string; asunto: string; html: string },
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  const token = await accessToken(config, fetchImpl);
  const res = await fetchImpl(`${config.mailUrl}/api/accounts/${encodeURIComponent(config.accountId)}/messages`, {
    method: "POST",
    headers: { Authorization: `Zoho-oauthtoken ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      fromAddress: correo.de,
      toAddress: correo.para,
      subject: correo.asunto,
      content: correo.html,
      mailFormat: "html",
      encoding: "UTF-8",
      askReceipt: "no",
    }),
  });
  const text = await res.text();
  const status = parse(text).status as { code?: unknown; description?: unknown } | undefined;
  if (!res.ok || (status && status.code !== 200)) {
    const motivo = typeof status?.description === "string" ? status.description : `HTTP ${res.status}`;
    throw new Error(`Zoho no mandó el correo (${redactZoho(motivo, config)}).`);
  }
}
