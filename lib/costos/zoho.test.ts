import { describe, expect, it } from "vitest";
import { type FetchLike, type ZohoConfig, enviarCorreoZoho, zohoConfigFromEnv } from "./zoho";

const config: ZohoConfig = {
  clientId: "1000.CLIENTE",
  clientSecret: "secreto-largo",
  refreshToken: "1000.refresh-largo",
  accountId: "794",
  accountsUrl: "https://accounts.zoho.com",
  mailUrl: "https://mail.zoho.com",
};
const correo = { de: "contacto@diluvium.com.mx", para: "dueno@example.com", asunto: "Costos", html: "<p>Hola</p>" };

function fake(respuestas: { ok: boolean; status: number; body: unknown }[]) {
  const llamadas: { url: string; init: Parameters<FetchLike>[1] }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    llamadas.push({ url, init });
    const r = respuestas[llamadas.length - 1];
    return { ok: r.ok, status: r.status, text: async () => JSON.stringify(r.body) };
  };
  return { fetchImpl, llamadas };
}

describe("zohoConfigFromEnv", () => {
  it("dice qué variables faltan", () => {
    expect(zohoConfigFromEnv({ ZOHO_CLIENT_ID: "x" })).toEqual({ faltan: ["ZOHO_CLIENT_SECRET", "ZOHO_REFRESH_TOKEN", "ZOHO_ACCOUNT_ID"] });
  });
  it("con todas, data center de Estados Unidos por defecto", () => {
    const out = zohoConfigFromEnv({ ZOHO_CLIENT_ID: "a", ZOHO_CLIENT_SECRET: "b", ZOHO_REFRESH_TOKEN: "c", ZOHO_ACCOUNT_ID: "d" });
    expect(out).toEqual({ config: { clientId: "a", clientSecret: "b", refreshToken: "c", accountId: "d", accountsUrl: "https://accounts.zoho.com", mailUrl: "https://mail.zoho.com" } });
  });
});

describe("enviarCorreoZoho", () => {
  it("pide el access token con el refresh token y manda un correo HTML de la cuenta", async () => {
    const { fetchImpl, llamadas } = fake([
      { ok: true, status: 200, body: { access_token: "tok-1h", expires_in: 3600 } },
      { ok: true, status: 200, body: { status: { code: 200, description: "success" }, data: {} } },
    ]);
    await enviarCorreoZoho(config, correo, fetchImpl);
    expect(llamadas[0].url).toBe("https://accounts.zoho.com/oauth/v2/token");
    expect(new URLSearchParams(llamadas[0].init.body).get("grant_type")).toBe("refresh_token");
    expect(llamadas[1].url).toBe("https://mail.zoho.com/api/accounts/794/messages");
    expect(llamadas[1].init.headers.Authorization).toBe("Zoho-oauthtoken tok-1h");
    expect(JSON.parse(llamadas[1].init.body)).toEqual({
      fromAddress: "contacto@diluvium.com.mx",
      toAddress: "dueno@example.com",
      subject: "Costos",
      content: "<p>Hola</p>",
      mailFormat: "html",
      encoding: "UTF-8",
      askReceipt: "no",
    });
  });

  it("si Zoho no da acceso, el error no lleva las llaves", async () => {
    const { fetchImpl } = fake([{ ok: false, status: 400, body: { error: `invalid_code ${config.refreshToken}` } }]);
    const error = await enviarCorreoZoho(config, correo, fetchImpl).catch((e: unknown) => e as Error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/^Zoho no dio acceso \(invalid_code \[llave\]\)/);
    expect((error as Error).message).not.toContain(config.refreshToken);
  });

  it("si Zoho rechaza el envío, falla con su motivo", async () => {
    const { fetchImpl } = fake([
      { ok: true, status: 200, body: { access_token: "tok" } },
      { ok: false, status: 400, body: { status: { code: 400, description: "Invalid fromAddress" } } },
    ]);
    await expect(enviarCorreoZoho(config, correo, fetchImpl)).rejects.toThrow("Zoho no mandó el correo (Invalid fromAddress).");
  });
});
