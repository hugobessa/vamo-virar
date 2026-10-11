import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { Text, View } from "react-native";
import { FlagStripe, Star, Wordmark } from "../brand";
import { fonts, palette, shear } from "../theme";

// Artwork for the app icon, the splash screen, the Play Store feature graphic
// and App Store promotional art. scripts/brand-assets.mjs screenshots these
// stories into assets/ (see app.json).

const S = 1024;

type Variant = "full" | "adaptive" | "monochrome";

const looks: Record<Variant, { bg: string; ink: string; depth: string | null; stripe: boolean; scale: number }> = {
  // iOS (in light and dark mode alike) and the store listings: full bleed, the OS rounds the corners.
  full: { bg: palette.red, ink: palette.white, depth: palette.redDark, stripe: true, scale: 1 },
  // Android adaptive foreground: transparent, kept inside the 66/108 safe zone.
  adaptive: { bg: "transparent", ink: palette.white, depth: palette.redDark, stripe: false, scale: 0.54 },
  // Android 13+ themed icon: one colour on transparent.
  monochrome: { bg: "transparent", ink: palette.white, depth: null, stripe: false, scale: 0.54 },
};

/** VAMO / VIRAR, sheared, with a depth shadow and a star: the icon's lettering. */
function Lettering({ size: f, ink, depth }: { size: number; ink: string; depth: string | null }) {
  const d = f * 0.056; // depth offset
  const word = (text: string, color: string, dx = 0, dy = 0) => (
    <Text
      key={text + color}
      style={{
        color,
        fontFamily: fonts.display,
        fontWeight: "900",
        fontSize: f,
        lineHeight: f * 0.92,
        letterSpacing: -f * 0.04,
        transform: [{ translateX: dx }, { translateY: dy }],
      }}
    >
      {text}
    </Text>
  );
  return (
    <View style={{ transform: [{ skewY: shear }] }}>
      {depth ? (
        <View style={{ position: "absolute", top: 0, left: 0 }}>
          {word("VAMO", depth, -d, d)}
          {word("VIRAR", depth, -d, d)}
        </View>
      ) : null}
      {word("VAMO", ink)}
      {word("VIRAR", ink)}
      <View style={{ position: "absolute", top: -f * 0.12, right: -f * 0.32 }}>
        <Star size={f * 0.42} color={ink} />
      </View>
    </View>
  );
}

function IconArt({ variant }: { variant: Variant }) {
  const l = looks[variant];
  return (
    <View style={{ width: S, height: S, backgroundColor: l.bg, alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
      {/* The shear and the star pull the words off-centre; nudge them back. */}
      <View style={{ transform: [{ translateX: -30 * l.scale }, { translateY: l.stripe ? -40 : 28 * l.scale }] }}>
        <Lettering size={250 * l.scale} ink={l.ink} depth={l.depth} />
      </View>
      {l.stripe ? (
        <View style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}>
          <FlagStripe height={S * 0.07} />
        </View>
      ) : null}
    </View>
  );
}

/** Google Play feature graphic, 1024×500. Written for members, the people who install the app. */
function FeatureGraphic() {
  const points = ["Veja os eventos da sua comunidade", "Diga se você pode ir em um toque", "Saiba quem mais vai"];
  return (
    <View style={{ width: 1024, height: 500, backgroundColor: palette.red, flexDirection: "row", alignItems: "center", overflow: "hidden" }}>
      <View style={{ width: 430, alignItems: "center", marginTop: -10 }}>
        <Lettering size={112} ink={palette.white} depth={palette.redDark} />
      </View>
      <View style={{ flex: 1, paddingRight: 56, marginTop: 0 }}>
        <Text
          style={{
            color: palette.white,
            fontFamily: fonts.condensed,
            fontWeight: "900",
            fontSize: 68,
            lineHeight: 64,
            letterSpacing: -1.5,
            textTransform: "uppercase",
            transform: [{ skewY: shear }],
          }}
        >
          Faça parte da sua comunidade
        </Text>
        <View style={{ marginTop: 58, gap: 10 }}>
          {points.map((p) => (
            <View key={p} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <Star size={22} color={palette.yellow} />
              <Text style={{ color: palette.white, fontFamily: fonts.text, fontWeight: "600", fontSize: 20 }}>{p}</Text>
            </View>
          ))}
        </View>
      </View>
      <View style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}>
        <FlagStripe height={22} />
      </View>
    </View>
  );
}

type Block = { x: number; y: number; w: number; h: number; fill: string; depth: string };
type Spark = { x: number; y: number; size: number };

const yellow = { fill: palette.yellow, depth: "#C9A600" };
const green = { fill: palette.green, depth: palette.greenDark };
const blue = { fill: palette.blue, depth: "#001F7D" };
const white = { fill: palette.offWhite, depth: "#CFCBD0" };

/**
 * App Store promotional art (product page header, search results): the
 * campaign's sheared colour blocks and stars on brand red, with no text or
 * logos. Positions are fractions of the artboard.
 */
const promoLayouts: Record<"promo" | "promo32" | "promoWide", { w: number; h: number; blocks: Block[]; sparks: Spark[] }> = {
  // Search results, 3:2: drawn at 1920×1280, shot at 1x and 2x (3840×2560).
  promo32: {
    w: 1920,
    h: 1280,
    blocks: [
      { x: 0.1, y: 0.16, w: 0.34, h: 0.4, ...yellow },
      { x: 0.35, y: 0.36, w: 0.26, h: 0.3, ...green },
      { x: 0.56, y: 0.1, w: 0.3, h: 0.38, ...blue },
      { x: 0.71, y: 0.46, w: 0.16, h: 0.2, ...white },
    ],
    sparks: [
      { x: 0.215, y: 0.22, size: 280 },
      { x: 0.655, y: 0.16, size: 120 },
      { x: 0.46, y: 0.13, size: 90 },
      { x: 0.9, y: 0.4, size: 80 },
      { x: 0.04, y: 0.58, size: 66 },
    ],
  },
  // Header and search results, 5244×2950 (about 16:9). Kept central, as it may be cropped.
  promo: {
    w: 5244,
    h: 2950,
    blocks: [
      { x: 0.14, y: 0.18, w: 0.3, h: 0.4, ...yellow },
      { x: 0.37, y: 0.38, w: 0.23, h: 0.3, ...green },
      { x: 0.55, y: 0.12, w: 0.27, h: 0.38, ...blue },
      { x: 0.69, y: 0.48, w: 0.14, h: 0.2, ...white },
    ],
    sparks: [
      { x: 0.245, y: 0.24, size: 640 },
      { x: 0.645, y: 0.18, size: 290 },
      { x: 0.47, y: 0.15, size: 210 },
      { x: 0.87, y: 0.4, size: 190 },
      { x: 0.08, y: 0.6, size: 160 },
    ],
  },
  // Header, wide: 3840×1646 (about 21:9).
  promoWide: {
    w: 3840,
    h: 1646,
    blocks: [
      { x: 0.2, y: 0.2, w: 0.24, h: 0.46, ...yellow },
      { x: 0.38, y: 0.42, w: 0.19, h: 0.36, ...green },
      { x: 0.53, y: 0.12, w: 0.22, h: 0.44, ...blue },
      { x: 0.66, y: 0.52, w: 0.12, h: 0.24, ...white },
    ],
    sparks: [
      { x: 0.285, y: 0.27, size: 420 },
      { x: 0.615, y: 0.19, size: 190 },
      { x: 0.47, y: 0.17, size: 140 },
      { x: 0.8, y: 0.42, size: 130 },
      { x: 0.13, y: 0.6, size: 110 },
    ],
  },
};

function PromoArt({ kind }: { kind: "promo" | "promo32" | "promoWide" }) {
  const { w, h, blocks, sparks } = promoLayouts[kind];
  const depth = Math.round(Math.min(w, h) * 0.022);
  return (
    <View style={{ width: w, height: h, backgroundColor: palette.red, overflow: "hidden" }}>
      {blocks.map((b, i) => (
        <View key={i} style={{ position: "absolute", left: b.x * w, top: b.y * h, width: b.w * w, height: b.h * h, transform: [{ skewY: shear }] }}>
          <View style={{ position: "absolute", top: depth, left: -depth, right: depth, bottom: -depth, backgroundColor: b.depth }} />
          <View style={{ flex: 1, backgroundColor: b.fill }} />
        </View>
      ))}
      {sparks.map((s, i) => (
        // The first, biggest star sits on the yellow block, so it is red like the campaign's.
        <View key={i} style={{ position: "absolute", left: s.x * w, top: s.y * h, transform: [{ skewY: shear }] }}>
          <Star size={s.size} color={i === 0 ? palette.red : palette.white} />
        </View>
      ))}
    </View>
  );
}

/**
 * The lockup centred on a transparent square, inside the circle Android 12+
 * crops splash images to. The background colour comes from app.json.
 */
function SplashArt() {
  return (
    <View style={{ width: S, height: S, alignItems: "center", justifyContent: "center" }}>
      {/* The lockup's padding is uneven; the translate centres what is drawn. */}
      <View style={{ transform: [{ translateX: -5 }, { translateY: -26 }, { scale: 2.15 }] }}>
        <Wordmark size="lg" />
      </View>
    </View>
  );
}

const meta: Meta = {
  title: "Marca/Ícone, abertura e destaque",
  parameters: { layout: "fullscreen", transparent: true },
};
export default meta;
type Story = StoryObj;

export const Icone: Story = { render: () => <IconArt variant="full" /> };
export const AndroidFrente: Story = { render: () => <IconArt variant="adaptive" /> };
export const AndroidMonocromatico: Story = { render: () => <IconArt variant="monochrome" /> };
export const Abertura: Story = { render: () => <SplashArt /> };
export const DestaquePlayStore: Story = { render: () => <FeatureGraphic /> };
export const PromocionalAppStore: Story = { render: () => <PromoArt kind="promo" /> };
export const PromocionalAppStore3x2: Story = { render: () => <PromoArt kind="promo32" /> };
export const PromocionalAppStoreLargo: Story = { render: () => <PromoArt kind="promoWide" /> };
