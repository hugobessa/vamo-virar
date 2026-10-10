import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { View } from "react-native";
import { BrandBox, Flag, FlagStripe, Star, Wordmark, type BoxSize, type BoxTone } from "../brand";
import { palette, space } from "../theme";

const meta: Meta<typeof BrandBox> = {
  title: "Marca/Caixas e detalhes",
  component: BrandBox,
  parameters: { layout: "padded" },
  argTypes: {
    tone: { control: "select", options: ["red", "green", "yellow", "blue", "white"] satisfies BoxTone[] },
    size: { control: "select", options: ["sm", "md", "lg", "xl"] satisfies BoxSize[] },
  },
  args: { tone: "red", size: "lg", children: "Vamo virar", skewed: true },
};
export default meta;
type Story = StoryObj<typeof BrandBox>;

export const Caixa: Story = {};

export const Tons: Story = {
  render: (args) => (
    <View style={{ gap: space.xl, padding: space.l }}>
      {(["red", "green", "yellow", "blue", "white"] as const).map((tone) => (
        <BrandBox key={tone} {...args} tone={tone}>
          {tone === "white" ? "Estrela" : tone}
        </BrandBox>
      ))}
    </View>
  ),
};

export const Bandeira: Story = {
  render: () => (
    <View style={{ gap: space.l, padding: space.l }}>
      <Flag width={120} />
      <Flag width={48} />
      <FlagStripe />
      <FlagStripe width={96} height={8} />
    </View>
  ),
};

export const Estrela: Story = {
  render: () => (
    <View style={{ flexDirection: "row", gap: space.l, padding: space.l, alignItems: "center" }}>
      <Star size={48} />
      <Star size={32} color={palette.blue} />
      <View style={{ backgroundColor: palette.red, padding: space.m }}>
        <Star size={32} color={palette.white} />
      </View>
    </View>
  ),
};

export const Marca: StoryObj<typeof Wordmark> = {
  render: () => (
    <View style={{ gap: space.xxl, padding: space.xl }}>
      <Wordmark size="xl" />
      <Wordmark size="lg" />
      <Wordmark size="md" />
      <Wordmark size="sm" />
    </View>
  ),
};
