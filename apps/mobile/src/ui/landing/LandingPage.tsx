import { useState, type ReactNode } from "react";
import { Pressable, Text, View, useWindowDimensions } from "react-native";
import { BrandBox, Display, Eyebrow, Flag, FlagStripe, Star, Wordmark, type BoxTone } from "../brand";
import { Card, Chip, Heading } from "../kit";
import { fonts, palette, space, type, useTheme } from "../theme";
import { Anchor, LinkButton, TextLink } from "./Anchor";
import { copy } from "./copy";
import { defaultLinks, type LandingLinks } from "./links";

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
    <View nativeID={id} style={{ backgroundColor: bg }}>
      <View style={{ width: "100%", maxWidth: l.max, alignSelf: "center", paddingHorizontal: l.gutter, paddingVertical: vertical, gap: l.xl ? space.xxl : space.xl }}>
        {children}
      </View>
    </View>
  );
}

/** Eyebrow and title at the top of a section. */
function SectionTitle({ eyebrow, title, eyebrowColor, tone, size = "h1" }: { eyebrow: string; title: string; eyebrowColor?: string; tone?: "onBrand"; size?: "display" | "h1" }) {
  const l = useLayout();
  return (
    <View style={{ gap: space.s, maxWidth: l.measure }}>
      <Eyebrow color={eyebrowColor}>{eyebrow}</Eyebrow>
      <Display size={l.xl && size === "h1" ? "display" : size} tone={tone}>
        {title}
      </Display>
    </View>
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
      <FlagStripe height={4} />
    </View>
  );
}

function PhoneMock() {
  const c = useTheme();
  const l = useLayout();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: l.xl ? 360 : 300,
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
        <Heading>{copy.mock.heading}</Heading>
        <Star size={20} />
      </View>
      {copy.mock.events.map((e) => (
        <Card key={e.title}>
          <Text style={{ color: c.text, fontFamily: fonts.text, ...type.bodyStrong }}>{e.title}</Text>
          <Text style={{ color: c.muted, fontFamily: fonts.text, ...type.small }}>{e.when}</Text>
          <Chip label={e.chip} tone={e.tone} />
        </Card>
      ))}
    </View>
  );
}

function Hero() {
  const l = useLayout();
  const c = useTheme();
  return (
    <Section bg={c.bg} pad={space.xxl}>
      <View style={{ flexDirection: l.split ? "row" : "column", alignItems: l.split ? "center" : "stretch", gap: l.split ? space.xxl : space.l }}>
        <View style={{ flex: l.split ? 1.25 : undefined, gap: space.l }}>
          <BrandBox tone="green" size="sm">{copy.hero.tag}</BrandBox>
          <Display size={l.xl ? "jumbo" : l.wide ? "display" : "h1"} tone="brand" skewed>
            {copy.hero.title}
          </Display>
          <Lead>{copy.hero.body}</Lead>
          {/* Wrapping a column would stop the buttons stretching, so only rows wrap. */}
          <View style={l.compact ? { gap: space.m, maxWidth: 420 } : { flexDirection: "row", flexWrap: "wrap", gap: space.m }}>
            <View style={{ minWidth: l.compact ? undefined : 200 }}>
              <LinkButton href="#baixar" label={copy.hero.create} />
            </View>
            <View style={{ minWidth: l.compact ? undefined : 200 }}>
              <LinkButton href="#baixar" kind="secondary" label={copy.hero.join} />
            </View>
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s }}>
            {copy.hero.trust.map((t) => (
              <Chip key={t} label={t} />
            ))}
          </View>
        </View>
        <View style={{ flex: l.split ? 1 : undefined, paddingVertical: space.l }}>
          <PhoneMock />
        </View>
      </View>
    </Section>
  );
}

/** Three items side by side from tablet width up, stacked on phones. */
function Row({ children }: { children: ReactNode }) {
  const l = useLayout();
  return <View style={{ flexDirection: l.split ? "row" : "column", gap: l.xl ? space.xxl : l.split ? space.xl : space.xxl }}>{children}</View>;
}

function Pillars() {
  const c = useTheme();
  return (
    <Section bg={c.surface}>
      <SectionTitle eyebrow={copy.pillars.eyebrow} title={copy.pillars.title} />
      <Row>
        {copy.pillars.items.map((p) => (
          <View key={p.n} style={{ flex: 1, gap: space.m, paddingTop: space.s }}>
            <BrandBox tone={p.tone as BoxTone} size="lg">{p.n}</BrandBox>
            <ItemTitle>{p.title}</ItemTitle>
            <ItemBody muted>{p.body}</ItemBody>
          </View>
        ))}
      </Row>
    </Section>
  );
}

function How() {
  const c = useTheme();
  const l = useLayout();
  return (
    <Section bg={c.bandYellow} id="como-funciona">
      <SectionTitle eyebrow={copy.how.eyebrow} title={copy.how.title} eyebrowColor={c.onBandYellow} />
      <Row>
        {copy.how.steps.map((s, i) => (
          <View key={s.title} style={{ flex: 1, gap: space.s }}>
            <Text
              accessibilityElementsHidden
              importantForAccessibility="no"
              style={{ color: c.bandNumber, fontFamily: fonts.condensed, fontWeight: "900", fontSize: l.xl ? 120 : l.compact ? 80 : 96, lineHeight: l.xl ? 114 : l.compact ? 78 : 92 }}
            >
              {i + 1}
            </Text>
            <ItemTitle color={c.onBandYellow}>{s.title}</ItemTitle>
            <ItemBody color={c.onBandYellow}>{s.body}</ItemBody>
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
        <View style={{ flex: 1 }}>
          <SectionTitle eyebrow={copy.privacy.eyebrow} title={copy.privacy.title} eyebrowColor={palette.white} tone="onBrand" size={l.compact ? "h1" : "display"} />
        </View>
        <View style={{ flex: 1, gap: space.l }}>
          {copy.privacy.items.map((t) => (
            <View key={t} style={{ flexDirection: "row", gap: space.m, alignItems: "flex-start" }}>
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

function Organizers({ links }: { links: LandingLinks }) {
  const c = useTheme();
  const l = useLayout();
  return (
    <Section bg={c.bg}>
      <View style={{ flexDirection: l.split ? "row" : "column", gap: space.xxl, alignItems: l.split ? "center" : "stretch" }}>
        <View style={{ flex: 1, gap: space.m }}>
          <SectionTitle eyebrow={copy.organizers.eyebrow} title={copy.organizers.title} />
          <ItemBody muted>{copy.organizers.body}</ItemBody>
          <View style={{ alignSelf: l.compact ? "stretch" : "flex-start", minWidth: l.compact ? undefined : 240 }}>
            <LinkButton href={links.serverDocs} kind="secondary" label={copy.organizers.cta} />
          </View>
        </View>
        {/* Decoration: a staircase of boxes. Smaller steps on phones so it never runs off the screen. */}
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ flex: 1, gap: l.compact ? space.m : space.l }}>
          {copy.organizers.chips.map((t, i) => (
            // The step is padding on a full-width row, so a long box wraps instead of running off the edge.
            <View key={t} style={{ paddingLeft: i * (l.compact ? 16 : 28), alignItems: "flex-start" }}>
              <BrandBox tone={(["blue", "green", "yellow"] as const)[i % 3] ?? "blue"} size={l.compact ? "md" : "lg"} style={{ maxWidth: "100%" }}>
                {t}
              </BrandBox>
            </View>
          ))}
        </View>
      </View>
    </Section>
  );
}

function FaqItem({ q, a, link, more }: { q: string; a: string; link?: string; more?: string }) {
  const c = useTheme();
  const l = useLayout();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: c.border }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((v) => !v)}
        style={{ minHeight: 64, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.l, paddingVertical: space.m }}
      >
        <Text style={{ flex: 1, color: c.text, fontFamily: fonts.text, fontSize: l.xl ? 20 : l.compact ? 17 : 18, fontWeight: "700", lineHeight: l.xl ? 30 : 26 }}>{q}</Text>
        <Text aria-hidden style={{ width: 24, textAlign: "center", color: c.primary, fontFamily: fonts.display, fontSize: 28, fontWeight: "900" }}>
          {open ? "−" : "+"}
        </Text>
      </Pressable>
      {open ? (
        <View style={{ paddingBottom: space.l, paddingRight: space.xxl, gap: space.xs }}>
          <ItemBody muted>{a}</ItemBody>
          {link && more ? <TextLink href={link}>{more}</TextLink> : null}
        </View>
      ) : null}
    </View>
  );
}

function Faq({ links }: { links: LandingLinks }) {
  const c = useTheme();
  const l = useLayout();
  return (
    <Section bg={c.cream} id="perguntas">
      <View style={{ flexDirection: l.wide ? "row" : "column", gap: l.wide ? space.huge : space.xl, alignItems: "flex-start" }}>
        <View style={{ flex: l.wide ? 2 : undefined }}>
          <SectionTitle eyebrow={copy.faq.eyebrow} title={copy.faq.title} />
        </View>
        <View style={{ flex: l.wide ? 3 : undefined, width: l.wide ? undefined : "100%", maxWidth: 880, borderTopWidth: 1, borderTopColor: c.border }}>
          {copy.faq.items.map((f) => (
            <FaqItem key={f.q} q={f.q} a={f.a} link={"link" in f ? links[f.link] : undefined} more={"more" in f ? f.more : undefined} />
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
          <Display size={l.compact ? "h1" : l.xl ? "jumbo" : "display"} tone="onBrand">
            {copy.cta.title}
          </Display>
          <Lead color={palette.white}>{copy.cta.body}</Lead>
        </View>
        <View style={{ gap: space.m, width: l.split ? 300 : "100%", maxWidth: l.split ? undefined : 420 }}>
          <LinkButton href={links.appStore} kind="accent" label={copy.cta.appStore} />
          <LinkButton href={links.playStore} kind="accent" label={copy.cta.playStore} />
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
      <FlagStripe height={8} />
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
  return (
    <View nativeID="topo">
      <Header />
      <Hero />
      <Pillars />
      <How />
      <Privacy links={links} />
      <Organizers links={links} />
      <Faq links={links} />
      <Download links={links} />
      <Footer links={links} />
    </View>
  );
}
