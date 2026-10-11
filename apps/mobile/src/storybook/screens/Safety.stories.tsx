import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import Safety from "../../app/safety";
import { screen } from "./helpers";

const meta: Meta = { title: "Telas/Segurança", parameters: { layout: "fullscreen" } };
export default meta;
type Story = StoryObj;

export const SegurancaEDenuncias: Story = screen(Safety, "Segurança e denúncias");
