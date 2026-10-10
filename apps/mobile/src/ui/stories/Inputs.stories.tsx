import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { useState } from "react";
import { View } from "react-native";
import { Field, Segmented } from "../kit";
import { space } from "../theme";

const meta: Meta<typeof Field> = {
  title: "Componentes/Campos",
  component: Field,
  parameters: { layout: "padded" },
  args: { label: "Nome da comunidade", placeholder: "Ex.: Horta da Vila" },
  decorators: [(Story) => <View style={{ maxWidth: 420 }}><Story /></View>],
};
export default meta;
type Story = StoryObj<typeof Field>;

export const Padrao: Story = {};
export const ComAjuda: Story = { args: { label: "Seu nome", help: "É assim que as outras pessoas vão ver você." } };
export const ComErro: Story = { args: { label: "Cole o link de convite", defaultValue: "vamo", error: "Esse link de convite não parece certo. Peça um novo para quem convidou você." } };

export const Abas: StoryObj<typeof Segmented> = {
  render: () => {
    const [v, setV] = useState<"eventos" | "pessoas" | "eu">("eventos");
    return (
      <View style={{ maxWidth: 420, gap: space.m }}>
        <Segmented
          value={v}
          onChange={setV}
          options={[
            { value: "eventos", label: "Eventos" },
            { value: "pessoas", label: "Pessoas" },
            { value: "eu", label: "Eu" },
          ]}
        />
      </View>
    );
  },
};
