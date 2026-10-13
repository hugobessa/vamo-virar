import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import Devices from "../../app/devices";
import Link from "../../app/link";
import LinkOffer from "../../app/link-offer";
import { entryNamed, screen } from "./helpers";

const meta: Meta = { title: "Telas/Aparelhos", parameters: { layout: "fullscreen" } };
export default meta;
type Story = StoryObj;

const comite = entryNamed("Comitê Casa Amarela");

export const SoEste: Story = screen(Devices, "Seus aparelhos", { entries: [comite], pathname: "/devices" });
export const CelularEComputador: Story = screen(Devices, "Seus aparelhos", {
  entries: [comite],
  pathname: "/devices",
  devices: [
    { label: "iPhone", me: true, main: true, communities: [comite.id] },
    { label: "Navegador", me: false, main: false, communities: [comite.id] },
  ],
});
export const LigarOutro: Story = screen(LinkOffer, "Ligar outro aparelho", { entries: [comite], pathname: "/link-offer" });
export const JaUsoEmOutro: Story = screen(Link, "Já uso em outro aparelho", { pathname: "/link" });
