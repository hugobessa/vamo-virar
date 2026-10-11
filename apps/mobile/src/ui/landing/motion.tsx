// Motion pieces for the landing page. Web only: these render DOM elements
// and lean on motion.css, so they live next to the page and never ship in
// the app. Everything respects prefers-reduced-motion (CSS) and the
// `motionOff()` check (for the JavaScript-driven timelines).

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Text, View } from "react-native";
import { BrandBox, Star } from "../brand";
import { ButtonFace, Chip } from "../kit";
import { fonts, motion, palette, shear, space, useTheme } from "../theme";
import { copy } from "./copy";
import "./motion.css";

/** True when the system asks for less motion or Storybook's toggle is off. */
export function motionOff(): boolean {
  if (typeof window === "undefined") return true;
  if (document.documentElement.dataset["vvMotion"] === "off") return true;
  return !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** Whether an element has scrolled into view (once). */
function useInView<T extends Element>(margin = "-5% 0px") {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined" || motionOff()) {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: margin, threshold: 0.05 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [margin]);
  return { ref, inView };
}

/**
 * Stamps its children into place when they scroll into view. Behaves like a
 * column `View` so it can sit inside the page's flex rows (`style` for
 * `flex: 1` and friends). `rise` lifts a big number out of a mask instead.
 */
export function Reveal({ children, delay = 0, rise, style, mask }: { children: ReactNode; delay?: number; rise?: boolean; style?: CSSProperties; mask?: boolean }) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const inner = (
    <div
      ref={mask ? undefined : ref}
      className={`vv-reveal${rise ? " vv-rise" : ""}${inView ? " is-in" : ""}`}
      style={{ display: "flex", flexDirection: "column", ...(mask ? {} : style), ["--vv-delay" as string]: `${delay}ms` }}
    >
      {children}
    </div>
  );
  return mask ? (
    <div ref={ref} className="vv-mask" style={{ display: "flex", flexDirection: "column", ...style }}>
      {inner}
    </div>
  ) : (
    inner
  );
}

/** Characters that flip in like a split-flap board; re-runs whenever `text` changes. */
export function FlipText({ text, stagger = 45 }: { text: string; stagger?: number }) {
  return (
    <span className="vv-flip" key={text} aria-hidden>
      {[...text].map((ch, i) => (
        <span key={i} className="vv-flip-char" style={{ ["--vv-delay" as string]: `${i * stagger}ms` }}>
          {ch === " " ? " " : ch}
        </span>
      ))}
    </span>
  );
}

/** Cycles through `words`, flipping each one in. */
export function FlipWord({ words, every = 2600 }: { words: readonly string[]; every?: number }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (motionOff() || words.length < 2) return;
    const t = setInterval(() => setI((n) => (n + 1) % words.length), every);
    return () => clearInterval(t);
  }, [words, every]);
  return <FlipText text={words[i] ?? ""} />;
}

/**
 * The hero headline, in the DOM so the number and the last word can flip:
 * "FALTAM 14 DIAS." over "VAMO VIRAR [O JOGO]". Sheared like `Display`.
 */
export function Headline({ title, lead, words, fontSize, lineHeight, color }: { title: string; lead: string; words: readonly string[]; fontSize: number; lineHeight: number; color: string }) {
  const digits = /\d+/.exec(title);
  const [before, after] = digits ? [title.slice(0, digits.index), title.slice(digits.index + digits[0].length)] : [title, ""];
  const lift = Math.round(fontSize * 0.5);
  return (
    <h1
      aria-label={`${title} ${lead} ${words[0] ?? ""}.`}
      style={{
        margin: `${lift}px 0`,
        color,
        fontFamily: fonts.condensed as string,
        fontSize,
        lineHeight: `${lineHeight}px`,
        fontWeight: 900,
        textTransform: "uppercase",
        letterSpacing: -fontSize * 0.02,
        transform: `skewY(${shear})`,
        transformOrigin: "0 100%",
        maxWidth: "100%",
      }}
    >
      <span aria-hidden style={{ display: "block" }}>
        {before}
        {digits ? <FlipText text={digits[0]} /> : null}
        {after}
      </span>
      <span aria-hidden style={{ display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: fontSize * 0.25, rowGap: 4 }}>
        <span>{lead}</span>
        <span
          style={{
            display: "inline-block",
            whiteSpace: "nowrap",
            background: palette.yellow,
            color: palette.ink,
            padding: `0 ${Math.round(fontSize * 0.18)}px`,
            boxShadow: `-${Math.round(fontSize * 0.08)}px ${Math.round(fontSize * 0.08)}px 0 #C9A600`,
            lineHeight: `${Math.round(fontSize * 1.05)}px`,
            minWidth: fontSize * 2.2,
          }}
        >
          <FlipWord words={words} />
        </span>
      </span>
    </h1>
  );
}

/** Three-colour stripe. `sweep` draws it in on load; `progress` fills it with the scroll. */
export function Stripe({ height = 4, sweep, progress }: { height?: number; sweep?: boolean; progress?: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!progress) return;
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 1;
      el.style.transform = `scaleX(${motionOff() ? 1 : p})`;
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [progress]);
  const spans = [palette.green, palette.yellow, palette.blue].map((bg) => <span key={bg} style={{ flex: 1, background: bg, ...(sweep ? {} : { animation: "none" }) }} />);
  return progress ? (
    <div ref={ref} className="vv-stripe" aria-hidden style={{ height }}>
      {spans}
    </div>
  ) : (
    <div aria-hidden className={sweep ? "vv-stripe" : undefined} style={{ position: "static", display: "flex", height }}>
      {spans}
    </div>
  );
}

/** Full-bleed band. Every band after the first is cut along the brand's angle (motion.css). */
export function Band({ bg, id, children }: { bg: string; id?: string; children: ReactNode }) {
  return (
    <section id={id} className="vv-band" style={{ background: bg, display: "flex", flexDirection: "column" }}>
      {children}
    </section>
  );
}

/** A slow loop of sheared boxes naming the kinds of action; pauses on hover. */
export function Marquee({ items }: { items: readonly string[] }) {
  const tones = ["red", "green", "yellow", "blue", "white"] as const;
  const row = (prefix: string) =>
    items.map((t, i) => (
      <View key={`${prefix}${t}`} style={{ paddingHorizontal: space.l, paddingVertical: space.m }}>
        <BrandBox tone={tones[i % tones.length] ?? "red"} size="md">
          {t}
        </BrandBox>
      </View>
    ));
  return (
    <div className="vv-marquee" aria-label={items.join(", ")} role="img">
      <div className="vv-marquee-track" aria-hidden>
        {row("a")}
        {row("b")}
      </div>
    </div>
  );
}

// --- Phone story --------------------------------------------------------------

const ASK_STEP = 1;
const ANSWERS_FROM = 3;

/**
 * The hero's phone, playing an eight-second loop: an organizer asks who can
 * come, answers pop in one by one, the bar fills to "9 de 12 podem ir".
 */
export function PhoneStory({ width = 300 }: { width?: number }) {
  const c = useTheme();
  const s = copy.story;
  const total = s.answers.length;
  const can = s.answers.filter((a) => a.tone === "ok").length;
  const RESULT = ANSWERS_FROM + total;
  const END = RESULT + 1;
  const [step, setStep] = useState(() => (motionOff() ? RESULT : 0));
  useEffect(() => {
    if (motionOff()) return;
    const wait = step === 0 ? 1400 : step === ASK_STEP ? 260 : step === ASK_STEP + 1 ? 500 : step < RESULT ? 260 : step === RESULT ? 3200 : 400;
    const t = setTimeout(() => setStep((n) => (n >= END ? 0 : n + 1)), wait);
    return () => clearTimeout(t);
  }, [step, RESULT, END]);
  const on = (at: number) => (step >= at && step < END ? " is-on" : "");
  const label = (text: string, strong?: boolean, color?: string) => (
    <Text style={{ color: color ?? c.text, fontFamily: fonts.text, fontSize: 14, lineHeight: 20, fontWeight: strong ? "700" : "400" }}>{text}</Text>
  );
  return (
    <View
      accessibilityLabel={`${s.event.title}. ${s.ask}. ${s.result(can, s.event.spots)}.`}
      style={{
        width,
        maxWidth: "100%",
        alignSelf: "center",
        backgroundColor: c.bg,
        borderRadius: 32,
        borderWidth: 6,
        borderColor: c.frame,
        padding: space.l,
        gap: space.m,
        transform: [{ rotate: "2deg" }],
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ color: c.text, fontFamily: fonts.text, fontSize: 17, fontWeight: "700" }}>{s.heading}</Text>
        <Star size={18} />
      </View>
      <View style={{ backgroundColor: c.surface, borderColor: c.border, borderWidth: 1, borderRadius: 12, padding: space.m, gap: space.s }}>
        {label(s.event.title, true)}
        {label(s.event.when, false, c.muted)}
        <div className={`vv-story-press${step === ASK_STEP ? " is-pressed" : ""}`} aria-hidden>
          <ButtonFace label={s.ask} kind="primary" />
        </div>
        <div className={`vv-story-item${on(ASK_STEP + 1)}`} aria-hidden>
          <Chip label={s.asked} />
        </div>
        <View style={{ gap: 2 }} aria-hidden>
          {s.answers.map((a, i) => (
            <div key={a.name} className={`vv-story-item${on(ANSWERS_FROM + i)}`} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              {label(a.name)}
              <Chip label={a.answer} tone={a.tone} />
            </div>
          ))}
        </View>
        <div className={`vv-story-item${on(RESULT)}`} aria-hidden style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div className={`vv-story-bar${on(RESULT)}`} style={{ background: c.chip, ["--vv-fill" as string]: `${Math.round((can / s.event.spots) * 100)}%` }}>
            <span style={{ background: c.green }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {step >= RESULT && step < END ? (
              <span className="vv-story-check" style={{ color: c.ok, fontWeight: 900 }}>
                ✓
              </span>
            ) : null}
            {label(s.result(can, s.event.spots), true, c.ok)}
          </div>
        </div>
      </View>
      {s.events.map((e) => (
        <View key={e.title} style={{ backgroundColor: c.surface, borderColor: c.border, borderWidth: 1, borderRadius: 12, padding: space.m, gap: 4 }}>
          {label(e.title, true)}
          {label(e.when, false, c.muted)}
          <Chip label={e.chip} tone={e.tone} />
        </View>
      ))}
      <Text style={{ color: c.muted, fontFamily: fonts.text, fontSize: 12, lineHeight: 16 }}>{s.footnote}</Text>
    </View>
  );
}

// --- Privacy diagram ------------------------------------------------------------

/**
 * What leaves the phone: the calendar and places stay behind a lock, and only
 * a small "Posso" travels to the community server, which holds ciphertext.
 * Drawn on reveal; the answer keeps travelling while the section is open.
 */
export function PrivacyDiagram({ ink = palette.white }: { ink?: string }) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const d = copy.privacy.diagram;
  const font = { fontFamily: fonts.text as string, fontWeight: 700 } as const;
  return (
    <div ref={ref} className={`vv-diagram${inView ? " is-in" : ""}`} style={{ width: "100%", maxWidth: 420 }}>
      <svg viewBox="0 0 400 200" width="100%" role="img" aria-label={`${d.calendar} e ${d.places} ficam no celular; só ${d.answer} vai para o ${d.server.toLowerCase()}, ${d.locked}.`}>
        {/* phone */}
        <rect className="vv-draw" pathLength={1} x="22" y="18" width="116" height="170" rx="18" fill="none" stroke={ink} strokeWidth="3" />
        <text className="vv-fade" x="80" y="40" textAnchor="middle" fill={ink} fontSize="11" style={font}>
          {d.phone}
        </text>
        {/* calendar grid */}
        <g className="vv-fade vv-shake" style={{ ["--vv-delay" as string]: "300ms" }}>
          <rect x="40" y="52" width="64" height="52" rx="4" fill={palette.yellow} />
          {[0, 1, 2].map((r) =>
            [0, 1, 2, 3].map((col) => <rect key={`${r}${col}`} x={46 + col * 14} y={60 + r * 13} width="10" height="9" rx="2" fill={r === 1 && col === 2 ? palette.red : palette.ink} opacity={r === 1 && col === 2 ? 1 : 0.25} />),
          )}
          <text x="72" y="118" textAnchor="middle" fill={ink} fontSize="10" style={font}>
            {d.calendar}
          </text>
        </g>
        {/* places pin */}
        <g className="vv-fade" style={{ ["--vv-delay" as string]: "450ms" }}>
          <circle cx="72" cy="146" r="9" fill={palette.green} />
          <circle cx="72" cy="146" r="3.5" fill={palette.ink} />
          <text x="72" y="172" textAnchor="middle" fill={ink} fontSize="10" style={font}>
            {d.places}
          </text>
        </g>
        {/* lock on the phone's edge */}
        <g className="vv-fade" style={{ ["--vv-delay" as string]: "600ms" }}>
          <rect x="112" y="84" width="22" height="18" rx="4" fill={palette.yellow} />
          <path d="M116 84 v-5 a7 7 0 0 1 14 0 v5" fill="none" stroke={palette.yellow} strokeWidth="3" />
          <circle cx="123" cy="93" r="2.5" fill={palette.ink} />
        </g>
        {/* the only thing that leaves: the answer */}
        <path className="vv-draw" pathLength={1} d="M 150 118 C 230 118, 260 118, 330 118" fill="none" stroke={ink} strokeWidth="2" strokeDasharray="1" strokeLinecap="round" />
        <path className="vv-fade" d="M 322 110 l 10 8 l -10 8" fill="none" stroke={ink} strokeWidth="2" strokeLinecap="round" style={{ ["--vv-delay" as string]: "900ms" }} />
        <g className="vv-travel">
          <rect x="-26" y="-11" width="52" height="22" rx="11" fill={palette.green} />
          <text x="0" y="4" textAnchor="middle" fill={palette.ink} fontSize="11" style={font}>
            {d.answer}
          </text>
        </g>
        {/* server */}
        <rect className="vv-draw" pathLength={1} x="332" y="70" width="50" height="96" rx="8" fill="none" stroke={ink} strokeWidth="3" />
        {[0, 1, 2].map((i) => (
          <rect key={i} className="vv-fade" x="342" y={82 + i * 24} width="30" height="14" rx="3" fill={ink} opacity="0.35" style={{ ["--vv-delay" as string]: `${700 + i * 120}ms` }} />
        ))}
        <text className="vv-fade" x="357" y="186" textAnchor="middle" fill={ink} fontSize="10" style={{ ...font, ["--vv-delay" as string]: "1000ms" }}>
          {d.locked}
        </text>
        <text className="vv-fade" x="240" y="100" textAnchor="middle" fill={ink} fontSize="10" style={{ ...font, ["--vv-delay" as string]: "1100ms" }}>
          {d.server}
        </text>
      </svg>
    </div>
  );
}

/** A FAQ entry whose answer grows open; the plus turns into a cross. */
export function Accordion({ question, children, open, onToggle, color, size, lineHeight }: { question: string; children: ReactNode; open: boolean; onToggle: () => void; color: string; size: number; lineHeight: number }) {
  const c = useTheme();
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        style={{
          all: "unset",
          cursor: "pointer",
          minHeight: 64,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: space.l,
          padding: `${space.m}px 0`,
          width: "100%",
          boxSizing: "border-box",
        }}
      >
        <span style={{ flex: 1, color, fontFamily: fonts.text as string, fontSize: size, fontWeight: 700, lineHeight: `${lineHeight}px` }}>{question}</span>
        <span aria-hidden className={`vv-faq-icon${open ? " is-open" : ""}`} style={{ width: 24, textAlign: "center", color: c.primary, fontFamily: fonts.display as string, fontSize: 28, fontWeight: 900 }}>
          +
        </span>
      </button>
      <div className={`vv-faq-body${open ? " is-open" : ""}`}>
        <div>{children}</div>
      </div>
    </>
  );
}

export const motionTokens = motion;
