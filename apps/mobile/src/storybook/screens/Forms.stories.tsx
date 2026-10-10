import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import Create from "../../app/create";
import Join from "../../app/join";
import NewEvent from "../../app/c/[id]/new-event";
import { entryNamed, screen } from "./helpers";

const meta: Meta = { title: "Telas/Formulários", parameters: { layout: "fullscreen" } };
export default meta;
type Story = StoryObj;

export const CriarComunidade: Story = screen(Create, "Criar uma comunidade");
export const EntrarComConvite: Story = screen(Join, "Entrar com um convite");
export const EntrarPeloLink: Story = screen(Join, "Entrar com um convite", {
  params: { c: "0a1b2c3d4e5f60718293a4b5c6d7e8f9", n: "https://horta.example.org", k: "9f8e7d6c5b4a39281706f5e4d3c2b1a0" },
});
export const NovoEvento: Story = screen(NewEvent, "Novo evento", { entries: [entryNamed("Horta da Vila", { id: "c1" })], params: { id: "c1" } });
