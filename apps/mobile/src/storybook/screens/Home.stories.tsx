import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import Home from "../../app/index";
import { entryNamed, makeEntry, screen } from "./helpers";

const meta: Meta = { title: "Telas/Início", parameters: { layout: "fullscreen" } };
export default meta;
type Story = StoryObj;

export const BoasVindas: Story = screen(Home, "Vamo Virar", { entries: [] });

export const ComComunidades: Story = screen(Home, "Vamo Virar", {
  entries: [entryNamed("Horta da Vila", { id: "c1" }), entryNamed("Coletivo Recife", { id: "c2" })],
});

export const PedidoEnviadoERecusado: Story = screen(Home, "Vamo Virar", {
  entries: [entryNamed("Horta da Vila", { id: "c1" }), makeEntry({ id: "c2", status: "joining" }), makeEntry({ id: "c3", status: "rejected" })],
});
