import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { Text, View } from "react-native";
import { FlagStripe, Star, Wordmark } from "../brand";
import { fonts, palette, shear } from "../theme";

// Artwork for the app icon, the splash screen and the Play Store feature
// graphic. scripts/brand-assets.mjs screenshots these stories into assets/
// (see app.json).

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
