import { describe, expect, it } from "vitest";
import { zernioErrorDetail } from "./zernio-error";

describe("motivo de un error de Zernio", () => {
  it("sobre de Zernio: `error` es el texto y `code` va al mismo nivel", () => {
    expect(zernioErrorDetail({ error: "budgetAmount is required", type: "invalid_request_error", code: "missing_required_field", param: "budgetAmount" }, 400)).toEqual({
      message: "budgetAmount is required",
      code: "missing_required_field",
    });
  });

  it("rechazo de Meta: suma lo que explica Meta (título y mensaje para el usuario)", () => {
    const body = {
      error: "Meta rejected the request",
      type: "platform_error",
      code: "platform_api_error",
      platform: "meta",
      platformError: {
        error: {
          message: "Invalid parameter",
          code: 100,
          error_subcode: 2388023,
          error_user_title: "Message template language is being deleted",
          error_user_msg: "New es_MX content can't be added while the existing es_MX content is being deleted. Try again in 4 weeks or consider creating a new message template.",
        },
      },
    };
    const detail = zernioErrorDetail(body, 400);
    expect(detail.message).toBe(
      "Meta rejected the request — Message template language is being deleted: New es_MX content can't be added while the existing es_MX content is being deleted. Try again in 4 weeks or consider creating a new message template.",
    );
    expect(detail.code).toBe("platform_api_error");
  });

  it("Meta sin texto de Zernio: su mensaje; sin nada, «Zernio respondió N»", () => {
    expect(zernioErrorDetail({ platformError: { message: "Invalid parameter" } }, 400).message).toBe("Invalid parameter");
    expect(zernioErrorDetail(null, 400)).toEqual({ message: "Zernio respondió 400", code: undefined });
    expect(zernioErrorDetail({}, 502).message).toBe("Zernio respondió 502");
  });

  it("formas viejas: { error: { message, code } } y { message }", () => {
    expect(zernioErrorDetail({ error: { code: "TEMPLATE_PAUSED", message: "Plantilla pausada" } }, 400)).toEqual({ message: "Plantilla pausada", code: "TEMPLATE_PAUSED" });
    expect(zernioErrorDetail({ message: "nombre duplicado" }, 409).message).toBe("nombre duplicado");
  });

  it("no repite lo que ya dice y recorta un texto enorme", () => {
    expect(zernioErrorDetail({ error: "Template name is being deleted", platformError: { error_user_msg: "Template name is being deleted" } }, 400).message).toBe("Template name is being deleted");
    expect(zernioErrorDetail({ error: "x".repeat(900) }, 400).message).toHaveLength(500);
  });
});
