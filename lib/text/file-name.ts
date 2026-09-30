// Nombres de archivo que se muestran al cliente en WhatsApp (chat y Biblioteca).
/**
 * Controles, invisibles y marcas de dirección (bidi): un nombre como
 * "Factura_\u202Efdp.exe" engañaría al cliente. Lo usan el chat y la Biblioteca.
 */
export const BAD_NAME_CHARS = /[\\/\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/;
