"use client";

// Corrector ortográfico de las cajas de texto del vendedor (20-oct-2026, docs/corrector.md).
// Se pone JUSTO ANTES de la <textarea> (`<SpellcheckOverlay textareaRef={ref} value={texto} />`)
// y no le cambia nada a la caja: encima dibuja una copia invisible del texto con la misma
// letra, medidas y scroll, y solo se ve el subrayado rojo de las palabras mal escritas. Clic
// izquierdo en una de ellas → menú con la palabra correcta, Ignorar y Agregar al diccionario.
// La revisión corre en un Web Worker (lib/spelling); la palabra que se está escribiendo no se
// marca hasta salir de ella.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { findMisspelled, getSuggestions } from "@/lib/spelling/client";
import { findWords, type WordToken } from "@/lib/spelling/tokens";
import { customWordKey } from "@/lib/spelling/rules";
import { useSpelling } from "./spelling-context";
import { SpellingMenu } from "./spelling-menu";
import { replaceTextareaRange } from "./replace-range";

type Props = { textareaRef: RefObject<HTMLTextAreaElement | null>; value: string };

type MenuState = WordToken & { anchor: DOMRect; suggestions: string[] | null };

const CHECK_DELAY_MS = 250;
const EMPTY: ReadonlySet<string> = new Set();

// Lo que hace que el texto de la copia caiga exactamente donde el de la caja.
const MIRRORED = [
  "fontFamily", "fontSize", "fontWeight", "fontStyle", "fontVariant", "fontStretch", "letterSpacing",
  "lineHeight", "textTransform", "textIndent", "wordSpacing", "tabSize", "textAlign", "direction",
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderRightWidth",
  "borderBottomWidth", "borderLeftWidth", "boxSizing", "overflowWrap", "wordBreak",
] as const;

const NAV_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);

export function SpellcheckOverlay({ textareaRef, value }: Props) {
  const { teamWords, addWord } = useSpelling();
  const boxRef = useRef<HTMLDivElement>(null);
  const [misspelled, setMisspelled] = useState<ReadonlySet<string>>(EMPTY);
  const [ignored, setIgnored] = useState<ReadonlySet<string>>(EMPTY);
  // Fin de la palabra que se está escribiendo (no se marca todavía).
  const [typingAt, setTypingAt] = useState<number | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);

  const tokens = useMemo(() => findWords(value), [value]);

  // Revisión en el Worker, un momento después de dejar de teclear.
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      findMisspelled(tokens.map((t) => t.word)).then((bad) => {
        if (alive) setMisspelled(bad);
      });
    }, CHECK_DELAY_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [tokens]);

  // «Ignorar» vale para ese mensaje: al enviarlo (caja vacía) se olvida. Se ajusta al
  // renderizar (patrón de React para estado que depende de una prop), sin efecto.
  const [wasEmpty, setWasEmpty] = useState(value === "");
  if ((value === "") !== wasEmpty) {
    setWasEmpty(value === "");
    if (value === "") setIgnored(EMPTY);
  }

  const issues = useMemo(
    () =>
      tokens.filter((t) => {
        if (!misspelled.has(t.word) || t.end === typingAt) return false;
        const key = customWordKey(t.word);
        return !teamWords.has(key) && !ignored.has(key);
      }),
    [tokens, misspelled, typingAt, teamWords, ignored],
  );
  const issuesRef = useRef(issues);
  useLayoutEffect(() => {
    issuesRef.current = issues;
  }, [issues]);

  // Copia encima de la caja: mismas medidas, misma letra, mismo scroll.
  const sync = useCallback(() => {
    const ta = textareaRef.current;
    const box = boxRef.current;
    if (!ta || !box) return;
    if (ta.offsetParent === null) {
      box.style.display = "none";
      return;
    }
    box.style.display = "";
    const cs = getComputedStyle(ta);
    for (const key of MIRRORED) box.style[key] = cs[key];
    const scrollbar = ta.offsetWidth - ta.clientWidth - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth);
    if (scrollbar > 0) box.style.paddingRight = `${parseFloat(cs.paddingRight) + scrollbar}px`;
    box.style.width = `${ta.offsetWidth}px`;
    box.style.height = `${ta.offsetHeight}px`;
    // Se mide en la pantalla (sirve también dentro de diálogos con transform).
    const curTop = parseFloat(box.style.top) || 0;
    const curLeft = parseFloat(box.style.left) || 0;
    const b = box.getBoundingClientRect();
    const t = ta.getBoundingClientRect();
    box.style.top = `${t.top - (b.top - curTop)}px`;
    box.style.left = `${t.left - (b.left - curLeft)}px`;
    box.scrollTop = ta.scrollTop;
    box.scrollLeft = ta.scrollLeft;
  }, [textareaRef]);

  useLayoutEffect(sync);

  const openMenuAt = useCallback((pos: number) => {
    const hit = issuesRef.current.find((i) => pos >= i.start && pos <= i.end);
    const span = hit ? boxRef.current?.querySelector(`[data-start="${hit.start}"]`) : null;
    if (!hit || !span) {
      setMenu(null);
      return;
    }
    setMenu({ ...hit, anchor: span.getBoundingClientRect(), suggestions: null });
    getSuggestions(hit.word).then((suggestions) =>
      setMenu((m) => (m && m.start === hit.start && m.word === hit.word ? { ...m, suggestions } : m)),
    );
  }, []);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    // El subrayado nativo del navegador se apaga: este lo sustituye.
    const nativeSpellcheck = ta.spellcheck;
    ta.spellcheck = false;

    let frame = 0;
    const syncSoon = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(sync);
    };
    const onInput = () => {
      setTypingAt(ta.selectionStart === ta.selectionEnd ? ta.selectionStart : null);
      setMenu(null);
    };
    const onClick = () => {
      setTypingAt(null);
      if (ta.selectionStart === ta.selectionEnd) openMenuAt(ta.selectionStart);
      else setMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (NAV_KEYS.has(event.key)) setTypingAt(null);
    };
    const onBlur = () => {
      setTypingAt(null);
      setMenu(null);
    };
    const onScroll = () => {
      syncSoon();
      setMenu(null);
    };
    const onOutside = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (target === ta || target?.closest?.("[data-spelling-menu]")) return;
      setMenu(null);
    };
    const resize = new ResizeObserver(syncSoon);
    resize.observe(ta);
    if (ta.parentElement) resize.observe(ta.parentElement);

    ta.addEventListener("input", onInput);
    ta.addEventListener("click", onClick);
    ta.addEventListener("keydown", onKeyDown);
    ta.addEventListener("keyup", onKeyUp);
    ta.addEventListener("blur", onBlur);
    ta.addEventListener("scroll", onScroll);
    window.addEventListener("resize", syncSoon);
    document.addEventListener("scroll", onScroll, true);
    document.addEventListener("mousedown", onOutside);
    return () => {
      ta.spellcheck = nativeSpellcheck;
      cancelAnimationFrame(frame);
      resize.disconnect();
      ta.removeEventListener("input", onInput);
      ta.removeEventListener("click", onClick);
      ta.removeEventListener("keydown", onKeyDown);
      ta.removeEventListener("keyup", onKeyUp);
      ta.removeEventListener("blur", onBlur);
      ta.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", syncSoon);
      document.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("mousedown", onOutside);
    };
  }, [textareaRef, sync, openMenuAt]);

  const pick = (suggestion: string) => {
    const ta = textareaRef.current;
    if (ta && menu && ta.value.slice(menu.start, menu.end) === menu.word) {
      replaceTextareaRange(ta, menu.start, menu.end, suggestion);
    }
    setMenu(null);
  };
  const ignore = () => {
    if (menu) setIgnored((prev) => new Set(prev).add(customWordKey(menu.word)));
    setMenu(null);
  };
  const add = () => {
    if (!menu) return;
    const { word } = menu;
    setMenu(null);
    addWord(word).catch((error: unknown) => {
      // La palabra vuelve a subrayarse (el contexto la quita); se avisa por qué.
      window.alert(`No se pudo agregar «${word}» al diccionario. ${error instanceof Error ? error.message : ""}`.trim());
    });
  };

  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const i of issues) {
    parts.push(value.slice(last, i.start));
    parts.push(
      <span
        key={i.start}
        data-start={i.start}
        data-spelling-error=""
      >
        {value.slice(i.start, i.end)}
      </span>,
    );
    last = i.end;
  }
  // El espacio invisible final hace que un salto de línea al final ocupe su renglón, como en la caja.
  parts.push(`${value.slice(last)}​`);

  return (
    <>
      <div
        ref={boxRef}
        aria-hidden="true"
        className="pointer-events-none absolute m-0 overflow-hidden border-solid border-transparent whitespace-pre-wrap text-transparent select-none"
      >
        {parts}
      </div>
      {menu && (
        <SpellingMenu anchor={menu.anchor} suggestions={menu.suggestions} onPick={pick} onIgnore={ignore} onAdd={add} />
      )}
    </>
  );
}
