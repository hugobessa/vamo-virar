import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { View } from "react-native";
import { Banner, Body, Card, Chip, Heading } from "../kit";
import { space } from "../theme";

const meta: Meta = {
  title: "Componentes/Cartões e avisos",
  parameters: { layout: "padded" },
  decorators: [(Story) => <View style={{ maxWidth: 420, gap: space.m }}><Story /></View>],
};
export default meta;
type Story = StoryObj;

export const Cartao: Story = {
  render: () => (
    <>
      <Card>
        <Heading>Mutirão da horta</Heading>
        <Body muted>Sábado, 10h · Praça da Vila</Body>
        <Chip label="Você pode ir" tone="ok" />
      </Card>
      <Card onPress={() => {}}>
        <Heading>Assembleia do bairro</Heading>
        <Body muted>Quinta, 19h30 · Salão paroquial</Body>
        <Chip label="Conflita com sua agenda" tone="warn" />
      </Card>
    </>
  ),
};

export const Etiquetas: Story = {
  render: () => (
    <View style={{ gap: space.s }}>
      <Chip label="Neutra" />
      <Chip label="Você pode ir" tone="ok" />
      <Chip label="Pedido enviado" tone="warn" />
      <Chip label="Pedido não aceito" tone="danger" />
    </View>
  ),
};

export const Avisos: Story = {
  render: () => (
    <>
      <Banner text="Sincronizado agora há pouco." />
      <Banner tone="ok" text="Evento criado." />
      <Banner tone="warn" text="Versão web de teste: os dados ficam sem proteção neste navegador." />
      <Banner tone="danger" text="Não foi possível entrar. Peça um novo convite." />
    </>
  ),
};
