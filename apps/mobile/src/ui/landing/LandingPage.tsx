import { useState, type ReactNode } from "react";
import { Text, View, useWindowDimensions } from "react-native";
import { BrandBox, Display, Eyebrow, Flag, Star, Wordmark, type BoxTone } from "../brand";
import { Chip, Progress } from "../kit";
import { fonts, motion, palette, space, type, useTheme } from "../theme";
import { Anchor, LinkButton, TextLink } from "./Anchor";
import { ACTIONS, FLIP_WORDS, copy, daysToRunoff, hero as heroCopy } from "./copy";
import { defaultLinks, type LandingLinks } from "./links";
import { Accordion, Band, Headline, Marquee, PhoneStory, PrivacyDiagram, Reveal, Stripe } from "./motion";

/**
 * Breakpoints: phones below 600, side-by-side layouts from 768 (tablets in
 * portrait), inline navigation from 960, and a wider column with larger type
 * from 1600 so ultra-wide screens don't show a thin strip of small text.
 */
function useLayout() {
  const { width } = useWindowDimensions();
  const compact = width < 600;
  const split = width >= 768;
  const wide = width >= 960;
  const xl = width >= 1600;
  return {
    compact,
    split,
    wide,
    xl,
    /** Width cap of the content column. */
    max: xl ? 1360 : 1160,
    /** Side padding of the content column. */
    gutter: width < 360 ? space.l : compact ? 20 : wide ? space.xxl : 32,
    /** Readable width for a section title or paragraph. */
    measure: xl ? 860 : 680,
  };
}

/** Full-bleed band with a centred, width-capped column. */
function Section({ bg, children, id, pad = space.huge }: { bg: string; children: ReactNode; id?: string; pad?: number }) {
  const l = useLayout();
  const vertical = l.xl ? pad * 1.25 : l.wide ? pad : l.split ? pad * 0.8 : pad * 0.6;
  return (
    <Band bg={bg} id={id}>
      <View style={{ width: "100%", maxWidth: l.max, alignSelf: "center", paddingHorizontal: l.gutter, paddingVertical: vertical, gap: l.xl ? space.xxl : space.xl }}>
        {children}
      </View>
    </Band>
  );
}

/** Eyebrow and title at the top of a section. */
function SectionTitle({ eyebrow, title, eyebrowColor, tone, size = "h1" }: { eyebrow: string; title: string; eyebrowColor?: string; tone?: "onBrand"; size?: "display" | "h1" }) {
  const l = useLayout();
  return (
    <Reveal>
      <View style={{ gap: space.s, maxWidth: l.measure }}>
        <Eyebrow color={eyebrowColor}>{eyebrow}</Eyebrow>
        <Display size={l.xl && size === "h1" ? "display" : size} tone={tone}>
          {title}
        </Display>
      </View>
    </Reveal>
  );
}

/** Body copy that grows a little with the screen. */
function Lead({ children, color, strong }: { children: ReactNode; color?: string; strong?: boolean }) {
  const c = useTheme();
  const l = useLayout();
  const size = l.xl ? 22 : l.wide ? 20 : l.split ? 18 : 17;
  return (
    <Text style={{ color: color ?? c.text, fontFamily: fonts.text, fontSize: size, lineHeight: Math.round(size * 1.5), fontWeight: strong ? "600" : "400", maxWidth: l.xl ? 640 : 560 }}>{children}</Text>
  );
}

/** Small heading over a card or a step. */
function ItemTitle({ children, color }: { children: ReactNode; color?: string }) {
  const c = useTheme();
  const l = useLayout();
  return (
    <Text accessibilityRole="header" style={{ color: color ?? c.text, fontFamily: fonts.display, fontWeight: "900", fontSize: l.xl ? 26 : 22, lineHeight: l.xl ? 32 : 27, letterSpacing: -0.5 }}>
      {children}
    </Text>
  );
}

function ItemBody({ children, color, muted }: { children: ReactNode; color?: string; muted?: boolean }) {
  const c = useTheme();
  const l = useLayout();
  return (
    <Text style={{ color: color ?? (muted ? c.muted : c.text), fontFamily: fonts.text, fontSize: l.xl ? 18 : 16, lineHeight: l.xl ? 28 : 24 }}>{children}</Text>
  );
}

function Header() {
  const c = useTheme();
  const l = useLayout();
  return (
    <View style={{ backgroundColor: c.bg }}>
      <Stripe progress />
      <View style={{ width: "100%", maxWidth: l.max, alignSelf: "center", flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: l.gutter, paddingVertical: space.s, gap: space.l }}>
        <Anchor href="#topo" label="Vamo Virar, início">
          <Wordmark size="sm" />
        </Anchor>
        {l.wide ? (
          <View role="navigation" style={{ flexDirection: "row", gap: space.xl }}>
            <TextLink href="#como-funciona" underline={false}>{copy.nav.how}</TextLink>
            <TextLink href="#privacidade" underline={false}>{copy.nav.privacy}</TextLink>
            <TextLink href="#perguntas" underline={false}>{copy.nav.faq}</TextLink>
          </View>
        ) : null}
        <View style={{ flexShrink: 0, minWidth: l.compact ? 96 : 180 }}>
          <LinkButton href="#baixar" label={l.compact ? "Baixar" : copy.nav.create} />
        </View>
      </View>
      <Stripe height={4} sweep />
    </View>
  );
}

function Hero() {
  const l = useLayout();
  const c = useTheme();
  const h = heroCopy(daysToRunoff());
  const fontSize = l.xl ? 112 : l.wide ? 84 : l.split ? 64 : 48;
  return (
    <Section bg={c.bg} pad={space.xxl}>
      <View style={{ flexDirection: l.split ? "row" : "column", alignItems: l.split ? "flex-start" : "stretch", gap: l.split ? space.xxl : space.l }}>
        <View style={{ flex: l.split ? 1.25 : undefined, gap: space.l, paddingTop: l.split ? space.xl : 0 }}>
          <Reveal>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.m, alignItems: "center" }}>
              <BrandBox tone="green" size="sm">{h.tag}</BrandBox>
            </View>
          </Reveal>
          <Headline title={h.title} lead={h.lead} words={FLIP_WORDS} fontSize={fontSize} lineHeight={Math.round(fontSize * 0.92)} color={c.brand} />
          <Reveal delay={motion.stagger * 2}>
            <Lead>{h.body}</Lead>
          </Reveal>
          {/* Wrapping a column would stop the buttons stretching, so only rows wrap. */}
          <Reveal delay={motion.stagger * 3}>
            <View style={l.compact ? { gap: space.m, maxWidth: 420 } : { flexDirection: "row", flexWrap: "wrap", gap: space.m }}>
              <View style={{ minWidth: l.compact ? undefined : 200 }}>
                <LinkButton href="#baixar" label={copy.hero.create} />
              </View>
              <View style={{ minWidth: l.compact ? undefined : 200 }}>
                <LinkButton href="#baixar" kind="secondary" label={copy.hero.join} />
              </View>
            </View>
          </Reveal>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s }}>
            {copy.hero.trust.map((t, i) => (
              <Reveal key={t} delay={motion.stagger * (4 + i)}>
                <Chip label={t} />
              </Reveal>
            ))}
          </View>
        </View>
        <View style={{ flex: l.split ? 1 : undefined, paddingVertical: space.l }}>
          <Reveal delay={motion.stagger * 2}>
            <PhoneStory width={l.xl ? 360 : 300} />
          </Reveal>
        </View>
      </View>
    </Section>
  );
}

/** Items side by side from tablet width up, stacked on phones; four items go 2×2 on tablets. */
function Row({ children, count = 3 }: { children: ReactNode; count?: number }) {
  const l = useLayout();
  const wrap = count > 3 && l.split && !l.wide;
  return <View style={{ flexDirection: l.split ? "row" : "column", flexWrap: wrap ? "wrap" : "nowrap", gap: l.xl ? space.xxl : l.split ? space.xl : space.xxl }}>{children}</View>;
}

function Problem() {
  const c = useTheme();
  return (
    <Section bg={c.surface}>
      <SectionTitle eyebrow={copy.problem.eyebrow} title={copy.problem.title} />
      <Row>
        {copy.problem.items.map((p, i) => (
          <Reveal key={p.title} delay={i * motion.stagger * 2} style={{ flex: 1 }}>
            <View style={{ gap: space.m, paddingTop: space.s }}>
              <BrandBox tone={p.tone as BoxTone} size="md">
                <Text style={{ color: p.tone === "red" || p.tone === "blue" ? palette.white : palette.ink, fontFamily: fonts.display, fontSize: 24, fontWeight: "900" }}>✕</Text>
              </BrandBox>
              <ItemTitle>{p.title}</ItemTitle>
              <ItemBody muted>{p.body}</ItemBody>
            </View>
          </Reveal>
        ))}
      </Row>
    </Section>
  );
}

function Pillars() {
  const c = useTheme();
  return (
    <Section bg={c.bg}>
      <SectionTitle eyebrow={copy.pillars.eyebrow} title={copy.pillars.title} />
      <Row>
        {copy.pillars.items.map((p, i) => (
          <Reveal key={p.n} delay={i * motion.stagger * 2} style={{ flex: 1 }}>
            <View style={{ gap: space.m, paddingTop: space.s }}>
              <BrandBox tone={p.tone as BoxTone} size="lg">{p.n}</BrandBox>
              <ItemTitle>{p.title}</ItemTitle>
              <ItemBody muted>{p.body}</ItemBody>
            </View>
          </Reveal>
        ))}
      </Row>
    </Section>
  );
}

/** Small sketches of the app, one per step of "Como funciona". */
function StepSketch({ step }: { step: number }) {
  const c = useTheme();
  const line = (w: number, strong?: boolean) => <View style={{ height: strong ? 10 : 8, width: w, borderRadius: 4, backgroundColor: strong ? c.text : c.border }} />;
  const box = (children: ReactNode) => (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ backgroundColor: c.bg, borderColor: c.border, borderWidth: 1, borderRadius: 12, padding: space.m, gap: space.s, alignSelf: "stretch" }}>
      {children}
    </View>
  );
  if (step === 0)
    return box(
      <>
        {line(90, true)}
        <View style={{ height: 30, borderRadius: 8, borderWidth: 1, borderColor: c.border }} />
        <View style={{ height: 30, borderRadius: 8, borderWidth: 1, borderColor: c.primary }} />
        <View style={{ height: 30, borderRadius: 8, backgroundColor: c.primary }} />
      </>,
    );
  if (step === 1)
    return box(
      <>
        <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
          <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: c.green }} />
          {line(70)}
        </View>
        <View style={{ alignSelf: "flex-start", backgroundColor: c.chip, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
          <Text style={{ color: c.text, fontFamily: fonts.text, fontSize: 12, fontWeight: "600" }}>vamovirar://join?…</Text>
        </View>
        <View style={{ flexDirection: "row", gap: 6 }}>
          <View style={{ flex: 1, height: 26, borderRadius: 8, backgroundColor: c.primary }} />
          <View style={{ flex: 1, height: 26, borderRadius: 8, borderWidth: 1, borderColor: c.border }} />
        </View>
      </>,
    );
  if (step === 2)
    return box(
      <>
        <View style={{ flexDirection: "row", gap: space.s }}>
          <Text style={{ color: c.brand, fontFamily: fonts.condensed, fontSize: 28, lineHeight: 30, fontWeight: "900" }}>18</Text>
          <View style={{ gap: 6, flex: 1, justifyContent: "center" }}>
            {line(100, true)}
            {line(70)}
          </View>
        </View>
        <Progress value={9} max={12} />
      </>,
    );
  return box(
    <>
      {line(110, true)}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        <Chip label="Posso" tone="ok" />
        <Chip label="Talvez" tone="warn" />
        <Chip label="Não posso" tone="danger" />
      </View>
      <Progress value={9} max={12} tone="ok" />
    </>,
  );
}

function How() {
  const c = useTheme();
  const l = useLayout();
  return (
    <Section bg={c.bandYellow} id="como-funciona">
      <SectionTitle eyebrow={copy.how.eyebrow} title={copy.how.title} eyebrowColor={c.onBandYellow} />
      <Row count={4}>
        {copy.how.steps.map((s, i) => (
          <View key={s.title} style={{ flex: l.wide ? 1 : undefined, flexBasis: l.split && !l.wide ? "46%" : undefined, gap: space.s }}>
            <Reveal rise mask delay={i * motion.stagger * 2}>
              <Text
                accessibilityElementsHidden
                importantForAccessibility="no"
                style={{ color: c.bandNumber, fontFamily: fonts.condensed, fontWeight: "900", fontSize: l.xl ? 120 : l.compact ? 80 : 96, lineHeight: l.xl ? 114 : l.compact ? 78 : 92 }}
              >
                {i + 1}
              </Text>
            </Reveal>
            <ItemTitle color={c.onBandYellow}>{s.title}</ItemTitle>
            <ItemBody color={c.onBandYellow}>{s.body}</ItemBody>
            <Reveal delay={i * motion.stagger * 2 + motion.base}>
              <StepSketch step={i} />
            </Reveal>
          </View>
        ))}
      </Row>
    </Section>
  );
}

function Privacy({ links }: { links: LandingLinks }) {
  const l = useLayout();
  const c = useTheme();
  return (
    <Section bg={c.bandRed} id="privacidade">
      <View style={{ flexDirection: l.split ? "row" : "column", gap: l.split ? space.xxl : space.xl, alignItems: l.split ? "flex-start" : "stretch" }}>
        <View style={{ flex: 1, gap: space.xl }}>
          <SectionTitle eyebrow={copy.privacy.eyebrow} title={copy.privacy.title} eyebrowColor={palette.white} tone="onBrand" size={l.compact ? "h1" : "display"} />
          <PrivacyDiagram ink={palette.white} />
        </View>
        <View style={{ flex: 1, gap: space.l }}>
          {copy.privacy.items.map((t, i) => (
            <Reveal key={t} delay={i * motion.stagger * 2}>
              <View style={{ flexDirection: "row", gap: space.m, alignItems: "flex-start" }}>
                <View style={{ paddingTop: 3 }}>
                  <Star size={22} color={palette.yellow} />
                </View>
                {/* Large, semibold text: white on the brand red is 4:1 */}
                <View style={{ flex: 1 }}>
                  <Lead color={palette.white} strong>
                    {t}
                  </Lead>
                </View>
              </View>
            </Reveal>
          ))}
          <View style={[{ columnGap: space.xl, rowGap: space.s, paddingTop: space.s }, l.compact ? { maxWidth: 420 } : { flexDirection: "row", flexWrap: "wrap", alignItems: "center" }]}>
            <View style={{ minWidth: l.compact ? undefined : 200 }}>
              <LinkButton href={links.source} kind="accent" label={copy.privacy.cta} />
            </View>
            <TextLink href={links.privacy} color={palette.white}>
              {copy.privacy.policy}
            </TextLink>
          </View>
        </View>
      </View>
    </Section>
  );
}

function Faq({ links }: { links: LandingLinks }) {
  const c = useTheme();
  const l = useLayout();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Section bg={c.cream} id="perguntas">
      <View style={{ flexDirection: l.wide ? "row" : "column", gap: l.wide ? space.huge : space.xl, alignItems: "flex-start" }}>
        <View style={{ flex: l.wide ? 2 : undefined }}>
          <SectionTitle eyebrow={copy.faq.eyebrow} title={copy.faq.title} />
        </View>
        <View style={{ flex: l.wide ? 3 : undefined, width: l.wide ? undefined : "100%", maxWidth: 880, borderTopWidth: 1, borderTopColor: c.border }}>
          {copy.faq.items.map((f) => (
            <View key={f.q} style={{ borderBottomWidth: 1, borderBottomColor: c.border }}>
              <Accordion
                question={f.q}
                open={open === f.q}
                onToggle={() => setOpen((v) => (v === f.q ? null : f.q))}
                color={c.text}
                size={l.xl ? 20 : l.compact ? 17 : 18}
                lineHeight={l.xl ? 30 : 26}
              >
                <View style={{ paddingBottom: space.l, paddingRight: space.xxl, gap: space.xs }}>
                  <ItemBody muted>{f.a}</ItemBody>
                  {"link" in f && "more" in f ? <TextLink href={links[f.link]}>{f.more}</TextLink> : null}
                </View>
              </Accordion>
            </View>
          ))}
        </View>
      </View>
    </Section>
  );
}

function Download({ links }: { links: LandingLinks }) {
  const l = useLayout();
  const c = useTheme();
  return (
    <Section bg={c.bandBlue} id="baixar">
      <View style={{ flexDirection: l.split ? "row" : "column", alignItems: l.split ? "center" : "stretch", justifyContent: "space-between", gap: space.xl }}>
        <View style={{ gap: space.m, flex: l.split ? 1 : undefined }}>
          <Reveal>
            <Display size={l.compact ? "h1" : l.xl ? "jumbo" : "display"} tone="onBrand" skewed>
              {copy.cta.title}
            </Display>
          </Reveal>
          <Reveal delay={motion.stagger * 2}>
            <Lead color={palette.white}>{copy.cta.body}</Lead>
          </Reveal>
        </View>
        <View style={{ gap: space.m, width: l.split ? 300 : "100%", maxWidth: l.split ? undefined : 420 }}>
          <Reveal delay={motion.stagger * 3}>
            <LinkButton href={links.appStore} kind="accent" label={copy.cta.appStore} />
          </Reveal>
          <Reveal delay={motion.stagger * 4}>
            <LinkButton href={links.playStore} kind="accent" label={copy.cta.playStore} />
          </Reveal>
        </View>
      </View>
    </Section>
  );
}

function Footer({ links }: { links: LandingLinks }) {
  const c = useTheme();
  const l = useLayout();
  return (
    <View style={{ backgroundColor: c.bg }}>
      <Stripe height={8} />
      <View style={{ width: "100%", maxWidth: l.max, alignSelf: "center", paddingHorizontal: l.gutter, paddingTop: space.xl, gap: space.l }}>
        {/* For the people who run the server: one line, not a section. */}
        <View style={{ flexDirection: l.split ? "row" : "column", alignItems: l.split ? "center" : "flex-start", gap: l.split ? space.xl : space.s, paddingBottom: space.l, borderBottomWidth: 1, borderBottomColor: c.border }}>
          <View style={{ flex: 1, gap: space.xs }}>
            <Eyebrow>{copy.organizers.title}</Eyebrow>
            <ItemBody muted>{copy.organizers.body}</ItemBody>
          </View>
          <TextLink href={links.serverDocs}>{copy.organizers.cta}</TextLink>
        </View>
      </View>
      <View
        style={{
          width: "100%",
          maxWidth: l.max,
          alignSelf: "center",
          paddingHorizontal: l.gutter,
          paddingVertical: space.xl,
          flexDirection: l.wide ? "row" : "column",
          alignItems: l.wide ? "center" : "flex-start",
          justifyContent: "space-between",
          gap: space.l,
        }}
      >
        <Anchor href="#topo" label="Vamo Virar, voltar ao início">
          <Wordmark size="sm" />
        </Anchor>
        <View style={{ flexShrink: 1, gap: space.xs, alignItems: l.wide ? "flex-end" : "flex-start" }}>
          <View role="navigation" style={{ flexDirection: "row", flexWrap: "wrap", columnGap: space.l, justifyContent: l.wide ? "flex-end" : "flex-start" }}>
            <TextLink href={links.source}>{copy.footer.source}</TextLink>
            <TextLink href={links.docs}>{copy.footer.docs}</TextLink>
            <TextLink href={links.privacy}>{copy.footer.privacy}</TextLink>
            <TextLink href={links.terms}>{copy.footer.terms}</TextLink>
            <TextLink href={links.childSafety}>{copy.footer.childSafety}</TextLink>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.s }}>
            <Flag width={28} />
            <Text style={{ color: c.muted, fontFamily: fonts.text, ...type.small }}>{copy.footer.open}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

export function LandingPage({ links = defaultLinks }: { links?: LandingLinks }) {
  const c = useTheme();
  return (
    <View nativeID="topo" style={{ overflow: "hidden" }}>
      <Header />
      <Hero />
      <Band bg={c.surface}>
        <View style={{ paddingVertical: space.m }}>
          <Marquee items={ACTIONS} />
        </View>
      </Band>
      <Problem />
      <Pillars />
      <How />
      <Privacy links={links} />
      <Faq links={links} />
      <Download links={links} />
      <Footer links={links} />
    </View>
  );
}
