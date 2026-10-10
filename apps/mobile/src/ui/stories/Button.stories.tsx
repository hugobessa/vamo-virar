import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { View } from "react-native";
import { Button } from "../kit";
import { palette, space } from "../theme";

const meta: Meta<typeof Button> = {
  title: "Componentes/Botão",
  component: Button,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Não existe botão vermelho: vermelho lê como perigo. `primary` é azul, `accent` é amarelo (para fundos coloridos), `secondary` é contorno e `danger` é contorno em vermelho escuro, só para ações destrutivas.",
      },
    },
  },
  argTypes: {
    kind: { control: "inline-radio", options: ["primary", "accent", "secondary", "danger"] },
    onPress: { action: "pressionado" },
  },
  args: { label: "Criar uma comunidade", kind: "primary" },
  decorators: [(Story) => <View style={{ maxWidth: 360 }}><Story /></View>],
};
export default meta;
type Story = StoryObj<typeof Button>;

export const Principal: Story = {};
export const Destaque: Story = {
  args: { kind: "accent", label: "Entrar com um convite" },
  decorators: [(Story) => <View style={{ backgroundColor: palette.blue, padding: space.l, borderRadius: 12 }}><Story /></View>],
};
export const Secundario: Story = { args: { kind: "secondary", label: "Entrar com um convite" } };
export const Destrutivo: Story = { args: { kind: "danger", label: "Sair da comunidade" } };
export const Ocupado: Story = { args: { busy: true } };
export const Desativado: Story = { args: { disabled: true } };

export const Todos: Story = {
  render: (args) => (
    <View style={{ gap: space.m }}>
      <Button {...args} kind="primary" label="Principal" />
      <Button {...args} kind="accent" label="Destaque" />
      <Button {...args} kind="secondary" label="Secundário" />
      <Button {...args} kind="danger" label="Destrutivo" />
      <Button {...args} kind="primary" label="Ocupado" busy />
      <Button {...args} kind="primary" label="Desativado" disabled />
    </View>
  ),
};
