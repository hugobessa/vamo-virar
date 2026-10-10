import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { Text, View } from "react-native";
import { Button } from "../kit";
import { Display, Eyebrow, FlagStripe } from "../brand";
import { fonts, palette, space, themes, useTheme } from "../theme";

const meta: Meta = { title: "Fundamentos/Cores", parameters: { layout: "padded" } };
export default meta;
type Story = StoryObj;

/** Relative luminance contrast of black/white text over a hex fill, for the swatch label. */
function readable(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? palette.ink : palette.white;
}

function Swatch({ name, hex, role, grow = 1 }: { name: string; hex: string; role: string; grow?: number }) {
  const ink = readable(hex);
  return (
    <View style={{ flexGrow: grow, flexBasis: 140, minHeight: 112, backgroundColor: hex, borderRadius: 12, padding: space.m, justifyContent: "flex-end", borderWidth: 1, borderColor: "#0001" }}>
      <Text style={{ color: ink, fontFamily: fonts.display, fontWeight: "800", fontSize: 15 }}>{name}</Text>
      <Text style={{ color: ink, fontFamily: fonts.text, fontSize: 12 }}>{hex}</Text>
      <Text style={{ color: ink, fontFamily: fonts.text, fontSize: 12, opacity: 0.85 }}>{role}</Text>
    </View>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.m }}>{children}</View>;
}

function Page() {
  const c = useTheme();
  return (
    <View style={{ gap: space.xl, maxWidth: 1000 }}>
      <View style={{ gap: space.s }}>
        <Display size="h1" tone="brand">Cores</Display>
        <Text style={{ color: c.text, fontFamily: fonts.text, fontSize: 16, lineHeight: 24 }}>
          O vermelho é a cor da marca: títulos grandes, caixas e decoração. As cores da bandeira (verde, amarelo, azul) entram como detalhe e como cor de ação.
        </Text>
      </View>
      <FlagStripe height={8} />

      <View style={{ gap: space.m }}>
        <Eyebrow>Paleta da marca</Eyebrow>
        <Row>
          <Swatch name="Vermelho" hex={palette.red} role="Marca. Nunca em botão de ação." grow={3} />
          <Swatch name="Azul" hex={palette.blue} role="Ação principal" grow={2} />
          <Swatch name="Amarelo" hex={palette.yellow} role="Ação de destaque, realce" grow={2} />
          <Swatch name="Verde" hex={palette.green} role="Detalhe, sucesso (fundo)" grow={2} />
        </Row>
        <Row>
          <Swatch name="Vermelho escuro" hex={palette.redDark} role="Erro e ações destrutivas" />
          <Swatch name="Verde escuro" hex={palette.greenDark} role="Texto de sucesso" />
          <Swatch name="Branco gelo" hex={palette.offWhite} role="Superfícies" />
          <Swatch name="Branco" hex={palette.white} role="Fundo" />
          <Swatch name="Creme" hex={palette.cream} role="Fundo suave" />
          <Swatch name="Roxo escuro" hex={palette.purpleDark} role="Uso mínimo" />
          <Swatch name="Roxo" hex={palette.purple} role="Foco do teclado" />
        </Row>
      </View>

      <View style={{ gap: space.m }}>
        <Eyebrow>Papéis (tema claro e escuro)</Eyebrow>
        {(["light", "dark"] as const).map((mode) => (
          <View key={mode} style={{ backgroundColor: themes[mode].bg, borderRadius: 12, padding: space.l, gap: space.s, borderWidth: 1, borderColor: themes[mode].border }}>
            <Text style={{ color: themes[mode].muted, fontFamily: fonts.text, fontSize: 12, fontWeight: "700" }}>{mode === "light" ? "CLARO" : "ESCURO"}</Text>
            <Row>
              {(["primary", "accent", "brand", "danger", "ok", "warn", "surface", "border", "muted", "text"] as const).map((k) => (
                <View key={k} style={{ width: 96, gap: 4 }}>
                  <View style={{ height: 40, borderRadius: 8, backgroundColor: themes[mode][k], borderWidth: 1, borderColor: "#0002" }} />
                  <Text style={{ color: themes[mode].text, fontFamily: fonts.text, fontSize: 12, fontWeight: "600" }}>{k}</Text>
                  <Text style={{ color: themes[mode].muted, fontFamily: fonts.text, fontSize: 11 }}>{themes[mode][k]}</Text>
                </View>
              ))}
            </Row>
          </View>
        ))}
      </View>

      <View style={{ gap: space.m }}>
        <Eyebrow>Regra: vermelho não é botão</Eyebrow>
        <Text style={{ color: c.text, fontFamily: fonts.text, fontSize: 15, lineHeight: 22 }}>
          Vermelho também significa "perigo". Por isso a ação principal é azul, a de destaque (sobre fundos coloridos) é amarela, e a ação destrutiva é só contorno em vermelho escuro, sempre com texto claro do que vai acontecer.
        </Text>
        <Row>
          <View style={{ flex: 1, minWidth: 260, gap: space.s }}>
            <Text style={{ color: c.ok, fontFamily: fonts.text, fontWeight: "700" }}>Faça</Text>
            <Button label="Criar uma comunidade" onPress={() => {}} />
            <Button kind="danger" label="Sair da comunidade" onPress={() => {}} />
          </View>
          <View style={{ flex: 1, minWidth: 260, gap: space.s }}>
            <Text style={{ color: c.danger, fontFamily: fonts.text, fontWeight: "700" }}>Não faça</Text>
            <View accessibilityRole="button" style={{ minHeight: 48, borderRadius: 12, backgroundColor: palette.red, alignItems: "center", justifyContent: "center", opacity: 0.55 }}>
              <Text style={{ color: palette.white, fontFamily: fonts.text, fontWeight: "700", fontSize: 17 }}>Criar uma comunidade</Text>
            </View>
            <Text style={{ color: c.muted, fontFamily: fonts.text, fontSize: 13 }}>Um botão vermelho de ação parece um alerta e se confunde com "excluir".</Text>
          </View>
        </Row>
      </View>
    </View>
  );
}

export const Paleta: Story = { render: () => <Page /> };
