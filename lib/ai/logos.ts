import type { ModelLogo } from "./types";

// Logo de cada marca de IA en las tarjetas de la subpestaña Modelos. Los archivos
// viven en public/logos-ia/ (se sirven desde el propio CRM, sin CDN): para cambiar
// un logo basta reemplazar su archivo con el mismo nombre. Origen: Lobe Icons
// (@lobehub/icons-static-svg 1.95.1, github.com/lobehub/lobe-icons), licencia MIT,
// Copyright (c) 2023 LobeHub. Los logos son marcas de sus dueños.
// `mono` = logo negro de un solo color: en modo oscuro se invierte a blanco.
export const MODEL_LOGOS = {
  openai: { src: "/logos-ia/openai.svg", mono: true },
  claude: { src: "/logos-ia/claude.svg", mono: false },
  gemini: { src: "/logos-ia/gemini.svg", mono: false },
  grok: { src: "/logos-ia/grok.svg", mono: true },
  qwen: { src: "/logos-ia/qwen.svg", mono: false },
} as const satisfies Record<ModelLogo, { src: string; mono: boolean }>;

export const MODEL_LOGO_IDS = Object.keys(MODEL_LOGOS) as ModelLogo[];
