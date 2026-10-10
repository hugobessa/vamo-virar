import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { LandingPage } from "../landing/LandingPage";

const meta: Meta<typeof LandingPage> = {
  title: "Páginas/Landing",
  component: LandingPage,
  parameters: { layout: "fullscreen" },
  argTypes: { onCreate: { action: "criar" }, onJoin: { action: "entrar" }, onOpenSource: { action: "código" }, onOpenDocs: { action: "documentação" } },
};
export default meta;
type Story = StoryObj<typeof LandingPage>;

export const Desktop: Story = { parameters: { viewport: { defaultViewport: "desktop" } } };
export const Celular: Story = { globals: { viewport: { value: "mobile1" } } };
