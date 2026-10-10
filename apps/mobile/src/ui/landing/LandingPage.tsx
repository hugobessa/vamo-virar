import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { BrandBox, Display, Eyebrow, Flag, FlagStripe, Star, Wordmark, type BoxTone } from "../brand";
import { Body, Button, Card, Chip, Heading } from "../kit";
import { fonts, palette, space, type, useTheme } from "../theme";
import { copy } from "./copy";

export type LandingActions = {
  onCreate?: () => void;
  onJoin?: () => void;
  onOpenSource?: () => void;
  onOpenDocs?: () => void;
};

const noop = () => {};

/** Wide layout from this width up (two columns, inline nav links). */
const WIDE = 880;

function useWide() {
  return useWindowDimensions().width >= WIDE;
}

/** Full-bleed band with a centred, width-capped column. */
function Section({ bg, children, id, pad = space.huge }: { bg: string; children: ReactNode; id?: string; pad?: number }) {
  const wide = useWide();
  return (
    <View nativeID={id} style={{ backgroundColor: bg }}>
      <View style={{ width: "100%", maxWidth: 1120, alignSelf: "center", paddingHorizontal: wide ? space.xxl : space.l, paddingVertical: wide ? pad : pad * 0.6, gap: space.xl }}>
        {children}
      </View>
    </View>
  );
}

function Header({ onCreate }: { onCreate: () => void }) {
  const c = useTheme();
  const wide = useWide();
  const link = { color: c.text, fontFamily: fonts.text, fontSize: 15, fontWeight: "600" as const };
  return (
    <View style={{ backgroundColor: c.bg, borderBottomWidth: 1, borderBottomColor: c.border }}>
      <View style={{ width: "100%", maxWidth: 1120, alignSelf: "center", flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: wide ? space.xxl : space.l, paddingVertical: space.s, gap: space.l }}>
        <Wordmark size="sm" />
        {wide ? (
          <View accessibilityRole="menu" style={{ flexDirection: "row", gap: space.xl }}>
            <Text accessibilityRole="link" style={link}>{copy.nav.how}</Text>
            <Text accessibilityRole="link" style={link}>{copy.nav.privacy}</Text>
            <Text accessibilityRole="link" style={link}>{copy.nav.faq}</Text>
          </View>
        ) : null}
        <View style={{ minWidth: wide ? 220 : 150 }}>
          <Button label={wide ? copy.nav.create : "Criar"} onPress={onCreate} />
        </View>
      </View>
      <FlagStripe height={4} />
    </View>
  );
}

function PhoneMock() {
  const c = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: 300, maxWidth: "100%", alignSelf: "center", backgroundColor: c.bg, borderRadius: 32, borderWidth: 6, borderColor: c.frame, padding: space.l, gap: space.m, transform: [{ rotate: "2deg" }] }}
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

function Hero({ onCreate, onJoin }: { onCreate: () => void; onJoin: () => void }) {
  const wide = useWide();
  const c = useTheme();
  return (
    <Section bg={c.bg} pad={space.xxl}>
      <View style={{ flexDirection: wide ? "row" : "column", alignItems: wide ? "center" : "stretch", gap: space.xxl }}>
        <View style={{ flex: wide ? 1.2 : undefined, gap: space.l }}>
          <BrandBox tone="green" size="sm">{copy.hero.tag}</BrandBox>
          <Display size={wide ? "display" : "h1"} tone="brand" skewed>
            {copy.hero.title}
          </Display>
          <Text style={{ color: c.text, fontFamily: fonts.text, fontSize: wide ? 20 : 17, lineHeight: wide ? 30 : 26, maxWidth: 520 }}>{copy.hero.body}</Text>
          <View style={{ flexDirection: wide ? "row" : "column", gap: space.m, maxWidth: wide ? undefined : 420 }}>
            <View style={{ minWidth: 220 }}>
              <Button label={copy.hero.create} onPress={onCreate} />
            </View>
            <View style={{ minWidth: 220 }}>
              <Button kind="secondary" label={copy.hero.join} onPress={onJoin} />
            </View>
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s }}>
            {copy.hero.trust.map((t) => (
              <Chip key={t} label={t} />
            ))}
          </View>
        </View>
        <View style={{ flex: wide ? 1 : undefined, paddingVertical: space.l }}>
          <PhoneMock />
        </View>
      </View>
    </Section>
  );
}

function Pillars() {
  const c = useTheme();
  const wide = useWide();
  return (
    <Section bg={c.surface}>
      <View style={{ gap: space.s, maxWidth: 680 }}>
        <Eyebrow>{copy.pillars.eyebrow}</Eyebrow>
        <Display size="h1">{copy.pillars.title}</Display>
      </View>
      <View style={{ flexDirection: wide ? "row" : "column", gap: space.xl }}>
        {copy.pillars.items.map((p) => (
          <View key={p.n} style={{ flex: 1, gap: space.m, paddingTop: space.s }}>
            <BrandBox tone={p.tone as BoxTone} size="lg">{p.n}</BrandBox>
            <Text accessibilityRole="header" style={{ color: c.text, fontFamily: fonts.display, fontWeight: "900", fontSize: 22, lineHeight: 26, letterSpacing: -0.5 }}>
              {p.title}
            </Text>
            <Body muted>{p.body}</Body>
          </View>
        ))}
      </View>
    </Section>
  );
}

function How() {
  const wide = useWide();
  const c = useTheme();
  return (
    <Section bg={c.bandYellow} id="como-funciona">
      <View style={{ gap: space.s, maxWidth: 680 }}>
        <Eyebrow color={c.onBandYellow}>{copy.how.eyebrow}</Eyebrow>
        <Display size="h1">{copy.how.title}</Display>
      </View>
      <View style={{ flexDirection: wide ? "row" : "column", gap: space.xl }}>
        {copy.how.steps.map((s, i) => (
          <View key={s.title} style={{ flex: 1, gap: space.s }}>
            <Text style={{ color: c.bandNumber, fontFamily: fonts.condensed, fontWeight: "900", fontSize: 96, lineHeight: 92 }}>{i + 1}</Text>
            <Text accessibilityRole="header" style={{ color: c.onBandYellow, fontFamily: fonts.display, fontWeight: "900", fontSize: 22, letterSpacing: -0.5 }}>
              {s.title}
            </Text>
            <Text style={{ color: c.onBandYellow, fontFamily: fonts.text, ...type.body }}>{s.body}</Text>
          </View>
        ))}
      </View>
    </Section>
  );
}

function Privacy({ onOpenSource }: { onOpenSource: () => void }) {
  const wide = useWide();
  const c = useTheme();
  return (
    <Section bg={c.bandRed} id="privacidade">
      <View style={{ flexDirection: wide ? "row" : "column", gap: space.xxl, alignItems: wide ? "flex-start" : "stretch" }}>
        <View style={{ flex: 1, gap: space.m }}>
          <Eyebrow color={palette.white}>{copy.privacy.eyebrow}</Eyebrow>
          <Display size="display" tone="onBrand">{copy.privacy.title}</Display>
        </View>
        <View style={{ flex: 1, gap: space.l }}>
          {copy.privacy.items.map((t) => (
            <View key={t} style={{ flexDirection: "row", gap: space.m, alignItems: "flex-start" }}>
              <Star size={22} color={palette.yellow} />
              {/* Large, semibold text: white on the brand red is 4:1 */}
              <Text style={{ flex: 1, color: palette.white, fontFamily: fonts.text, fontSize: 19, lineHeight: 28, fontWeight: "600" }}>{t}</Text>
            </View>
          ))}
          <View style={{ alignSelf: "flex-start", minWidth: 220 }}>
            <Button kind="accent" label={copy.privacy.cta} onPress={onOpenSource} />
          </View>
        </View>
      </View>
    </Section>
  );
}

function Organizers({ onOpenDocs }: { onOpenDocs: () => void }) {
  const c = useTheme();
  const wide = useWide();
  return (
    <Section bg={c.bg}>
      <View style={{ flexDirection: wide ? "row" : "column", gap: space.xxl, alignItems: wide ? "center" : "stretch" }}>
        <View style={{ flex: 1, gap: space.m }}>
          <Eyebrow>{copy.organizers.eyebrow}</Eyebrow>
          <Display size="h1">{copy.organizers.title}</Display>
          <Body muted>{copy.organizers.body}</Body>
          <View style={{ alignSelf: "flex-start", minWidth: 240 }}>
            <Button kind="secondary" label={copy.organizers.cta} onPress={onOpenDocs} />
          </View>
        </View>
        <View style={{ flex: 1, gap: space.l, alignItems: "flex-start" }}>
          {copy.organizers.chips.map((t, i) => (
            <BrandBox key={t} tone={(["blue", "green", "yellow"] as const)[i % 3] ?? "blue"} size="lg" style={{ marginLeft: i * 28 }}>
              {t}
            </BrandBox>
          ))}
        </View>
      </View>
    </Section>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  const c = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: c.border }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((v) => !v)}
        style={{ minHeight: 64, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.l, paddingVertical: space.m }}
      >
        <Text style={{ flex: 1, color: c.text, fontFamily: fonts.text, fontSize: 18, fontWeight: "700", lineHeight: 26 }}>{q}</Text>
        <Text style={{ color: c.primary, fontFamily: fonts.display, fontSize: 28, fontWeight: "900" }}>{open ? "−" : "+"}</Text>
      </Pressable>
      {open ? <Text style={{ color: c.muted, fontFamily: fonts.text, ...type.body, paddingBottom: space.l }}>{a}</Text> : null}
    </View>
  );
}

function Faq() {
  const c = useTheme();
  return (
    <Section bg={c.cream} id="perguntas">
      <View style={{ gap: space.s, maxWidth: 680 }}>
        <Eyebrow>{copy.faq.eyebrow}</Eyebrow>
        <Display size="h1">{copy.faq.title}</Display>
      </View>
      <View style={{ maxWidth: 800, borderTopWidth: 1, borderTopColor: c.border }}>
        {copy.faq.items.map((f) => (
          <FaqItem key={f.q} {...f} />
        ))}
      </View>
    </Section>
  );
}

function FinalCta({ onCreate, onJoin }: { onCreate: () => void; onJoin: () => void }) {
  const wide = useWide();
  const c = useTheme();
  return (
    <Section bg={c.bandBlue}>
      <View style={{ flexDirection: wide ? "row" : "column", alignItems: wide ? "center" : "stretch", justifyContent: "space-between", gap: space.xl }}>
        <View style={{ gap: space.s, flex: 1 }}>
          <Display size="display" tone="onBrand">{copy.cta.title}</Display>
          <Text style={{ color: palette.white, fontFamily: fonts.text, fontSize: 19, lineHeight: 28 }}>{copy.cta.body}</Text>
        </View>
        <View style={{ gap: space.m, minWidth: 260 }}>
          <Button kind="accent" label={copy.cta.create} onPress={onCreate} />
          <Pressable accessibilityRole="link" onPress={onJoin} style={{ minHeight: 44, justifyContent: "center", alignItems: "center" }}>
            <Text style={{ color: palette.white, fontFamily: fonts.text, fontSize: 16, fontWeight: "700", textDecorationLine: "underline" }}>{copy.cta.join}</Text>
          </Pressable>
        </View>
      </View>
    </Section>
  );
}

function Footer({ onOpenSource, onOpenDocs }: { onOpenSource: () => void; onOpenDocs: () => void }) {
  const c = useTheme();
  const link = { color: c.text, fontFamily: fonts.text, fontSize: 15, fontWeight: "600" as const, textDecorationLine: "underline" as const };
  return (
    <View style={{ backgroundColor: c.bg }}>
      <FlagStripe height={8} />
      <View style={{ width: "100%", maxWidth: 1120, alignSelf: "center", paddingHorizontal: space.l, paddingVertical: space.xl, flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: space.l }}>
        <Wordmark size="sm" />
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.l, flexWrap: "wrap" }}>
          <Flag width={28} />
          <Text accessibilityRole="link" onPress={onOpenSource} style={link}>{copy.footer.source}</Text>
          <Text accessibilityRole="link" onPress={onOpenDocs} style={link}>{copy.footer.docs}</Text>
          <Text style={{ color: c.muted, fontFamily: fonts.text, ...type.small }}>{copy.footer.open}</Text>
        </View>
      </View>
    </View>
  );
}

export function LandingPage({ onCreate = noop, onJoin = noop, onOpenSource = noop, onOpenDocs = noop }: LandingActions) {
  return (
    <ScrollView>
      <Header onCreate={onCreate} />
      <Hero onCreate={onCreate} onJoin={onJoin} />
      <Pillars />
      <How />
      <Privacy onOpenSource={onOpenSource} />
      <Organizers onOpenDocs={onOpenDocs} />
      <Faq />
      <FinalCta onCreate={onCreate} onJoin={onJoin} />
      <Footer onOpenSource={onOpenSource} onOpenDocs={onOpenDocs} />
    </ScrollView>
  );
}
