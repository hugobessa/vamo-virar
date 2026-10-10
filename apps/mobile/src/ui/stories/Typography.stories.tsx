import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { Text, View } from "react-native";
import { Display, Eyebrow } from "../brand";
import { fonts, space, type, useTheme } from "../theme";

const meta: Meta = { title: "Fundamentos/Tipografia", parameters: { layout: "padded" } };
export default meta;
type Story = StoryObj;

function Sample({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space.xs, borderBottomWidth: 1, borderColor: "#0002", paddingBottom: space.l }}>
      <Eyebrow>{label}</Eyebrow>
      {children}
    </View>
  );
}

function Page() {
  const c = useTheme();
  const base = { color: c.text, fontFamily: fonts.text } as const;
  return (
    <View style={{ gap: space.l, maxWidth: 900 }}>
      <Display size="h1" tone="brand">Tipografia</Display>
      <Text style={{ ...base, ...type.body }}>
        Títulos em caixa alta, pesados e apertados (guia: Transducer Condensed Black, entreletras -5 a -10). Texto corrido em Gotham. Aqui usamos Barlow Condensed, Archivo e Montserrat, que são livres, até a licença das fontes originais entrar.
      </Text>
      <Sample label="Display · condensada preta">
        <Display size="display">O Brasil pronto pra virar</Display>
      </Sample>
      <Sample label="H1">
        <Display size="h1">Organize sua comunidade</Display>
      </Sample>
      <Sample label="H2">
        <Display size="h2">Sua agenda fica no seu celular</Display>
      </Sample>
      <Sample label="Inclinado (-11,3°)">
        <Display size="h1" tone="brand" skewed>Vamo virar</Display>
      </Sample>
      <Sample label="Subtítulo · larga preta">
        <Text style={{ color: c.text, fontFamily: fonts.display, fontWeight: "900", fontSize: 22, letterSpacing: -0.6, textTransform: "uppercase" }}>Eventos, pessoas, tempo livre</Text>
      </Sample>
      <Sample label="H3">
        <Text style={{ ...base, ...type.h3 }}>Quem pode ir ao encontro de sábado</Text>
      </Sample>
      <Sample label="Texto corrido">
        <Text style={{ ...base, ...type.body }}>
          Crie eventos, convide pessoas e veja quem pode participar. Sua agenda e sua localização ficam só no seu celular.
        </Text>
      </Sample>
      <Sample label="Texto pequeno">
        <Text style={{ color: c.muted, fontFamily: fonts.text, ...type.small }}>Atualizado há 2 minutos · sincronizado</Text>
      </Sample>
    </View>
  );
}

export const Escala: Story = { render: () => <Page /> };
