import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { userEvent, within } from "storybook/test";
import AdminScreen from "../../app/c/[id]/admin";
import { COMMUNITY_NAME } from "../scenario";
import { makeEntry, openTab, screen } from "./helpers";

const meta: Meta = { title: "Telas/Administração", parameters: { layout: "fullscreen" } };
export default meta;
type Story = StoryObj;

const admin = (o: Parameters<typeof makeEntry>[0] = {}, section?: string, extra: Partial<Story> = {}): Story => ({
  ...screen(AdminScreen, COMMUNITY_NAME, { entries: [makeEntry({ id: "c1", ...o })], params: { id: "c1", ...(section ? { section } : {}) } }),
  ...extra,
});

/** Ana (coordination) opens on the people asking to join, with the invite link under them. */
export const EntradaComoCoordenacao: Story = admin({ joinRequests: true });
export const EntradaSemPedidos: Story = admin({});
/** Every member with a menu of roles, removal and blocking; the blocked list under them. */
export const PessoasComoCoordenacao: Story = admin({ reports: true }, "people");
export const MenuDeUmaPessoa: Story = admin({ moderator: true }, "people", {
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByTestId("member-menu-caio"));
  },
});
export const DenunciasComoCoordenacao: Story = admin({ reports: true }, "reports");
/** The WhatsApp group, the recovery code, the server and disabling the community. */
export const ComunidadeComoCoordenacao: Story = admin({}, "community");
/** Duda moderates: requests, reports and blocking, but no roles and no community settings. */
export const EntradaComoModeracao: Story = admin({ me: "duda", moderator: true, joinRequests: true, reports: true });
export const PessoasComoModeracao: Story = admin({ me: "duda", moderator: true, reports: true }, "people");
/** The same, reached by tapping the section like a person would. */
export const DenunciasComoModeracao: Story = admin({ me: "duda", moderator: true, reports: true }, undefined, { play: openTab(/^Denúncias/) });
/** Another admin can re-enable a community that Bia disabled; Ana, who disabled it herself, cannot. */
export const ReativarComoOutraAdmin: Story = admin({ me: "ana", secondAdmin: true, disabledBy: "bia" }, "community");
export const DesativadaPorMim: Story = admin({ me: "ana", secondAdmin: true, disabledBy: "ana" }, "community");
/** A member who types the address by hand gets nothing. */
export const ComoMembro: Story = admin({ me: "caio" });
