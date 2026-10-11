import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import Home from "../../app/index";
import { COMMUNITY_NAME } from "../scenario";
import { entryNamed, makeEntry, screen } from "./helpers";

const meta: Meta = { title: "Telas/Início", parameters: { layout: "fullscreen" } };
export default meta;
type Story = StoryObj;

export const BoasVindas: Story = screen(Home, "Vamo Virar", { entries: [] });

export const ComComunidades: Story = screen(Home, "Vamo Virar", {
  entries: [entryNamed(COMMUNITY_NAME, { id: "c1" }), entryNamed("Coletivo Recife", { id: "c2" })],
});

export const ComunidadeMarcadaParaExclusao: Story = screen(Home, "Vamo Virar", {
  entries: [entryNamed(COMMUNITY_NAME, { id: "c1" }), entryNamed("Coletivo Recife", { id: "c2", disabledBy: "ana" })],
});

export const PedidoEnviadoERecusado: Story = screen(Home, "Vamo Virar", {
  entries: [entryNamed(COMMUNITY_NAME, { id: "c1" }), makeEntry({ id: "c2", status: "joining" }), makeEntry({ id: "c3", status: "rejected" })],
});
