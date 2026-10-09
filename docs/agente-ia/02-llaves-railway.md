> Parte de [docs/agente-ia.md](../agente-ia.md) (índice por tema y fecha).

## Llaves (Railway)

`OPENAI_API_KEY` y `ANTHROPIC_API_KEY` van en el **servicio web** (`crm-diluvium`),
en `production` y `staging` (el web las usa para saber qué modelos salen en gris en el
selector; el dry-run "Probar modelo" se quitó de la pestaña el 24-sep-2026), y se
referencian desde el **worker**:

```bash
railway variable set 'OPENAI_API_KEY=${{crm-diluvium.OPENAI_API_KEY}}' -s worker -e staging
railway variable set 'ANTHROPIC_API_KEY=${{crm-diluvium.ANTHROPIC_API_KEY}}' -s worker -e staging
```

**En producción el worker es OTRO servicio: `worker-production`** (id 189e0d41). El
servicio `worker` (id e2140b5d) existe SOLO en staging; en production no tiene
instancia. **Nunca usar `-s worker -e production`**: guarda variables huérfanas que
nada lee (pasó en la Fase A; se borraron el 22-sep-2026). Con un servicio sin instancia
en ese entorno, apuntar por ID (`-s e2140b5d-…`) en vez de por nombre. Estado al
22-sep-2026: las llaves de IA están en `worker-production` como referencia al web:

```bash
railway variable set 'OPENAI_API_KEY=${{crm-diluvium.OPENAI_API_KEY}}' 'ANTHROPIC_API_KEY=${{crm-diluvium.ANTHROPIC_API_KEY}}' -s worker-production -e production
```

Comillas **simples**:
zsh trata `${{...}}` como *bad substitution* con comillas dobles. Una opción del
selector cuya llave falte queda en gris automáticamente.

**Fase E — llaves nuevas** (mismo patrón: el valor en el web, el worker lo referencia):
`GEMINI_API_KEY` (Gemini), `GROK_API_KEY` (Grok) y `QWEN_API_KEY` (Qwen).

```bash
railway variable set 'GEMINI_API_KEY=${{crm-diluvium.GEMINI_API_KEY}}' 'GROK_API_KEY=${{crm-diluvium.GROK_API_KEY}}' 'QWEN_API_KEY=${{crm-diluvium.QWEN_API_KEY}}' -s worker-production -e production
railway variable set 'GEMINI_API_KEY=${{crm-diluvium.GEMINI_API_KEY}}' 'GROK_API_KEY=${{crm-diluvium.GROK_API_KEY}}' 'QWEN_API_KEY=${{crm-diluvium.QWEN_API_KEY}}' -s worker -e staging
```
