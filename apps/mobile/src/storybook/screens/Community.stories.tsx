import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { userEvent, within } from "storybook/test";
import EventsRoute from "../../app/c/[id]/(tabs)/index";
import MeRoute from "../../app/c/[id]/(tabs)/me";
import PeopleRoute from "../../app/c/[id]/(tabs)/people";
import { COMMUNITY_NAME } from "../scenario";
import { makeEntry, screen } from "./helpers";

const meta: Meta = { title: "Telas/Comunidade", parameters: { layout: "fullscreen" } };
export default meta;
type Story = StoryObj;

type Tab = "index" | "people" | "me";
const ROUTES = { index: EventsRoute, people: PeopleRoute, me: MeRoute };
/** One section of the community, with the tab bar under it. */
const section = (tab: Tab, o: Parameters<typeof makeEntry>[0] = {}, extra: Partial<Story> = {}): Story => ({
  ...screen(ROUTES[tab], COMMUNITY_NAME, { entries: [makeEntry({ id: "c1", ...o })], params: { id: "c1" }, tab }),
  ...extra,
});

/** Ana (coordination) has the administration in the header; the tab bar is the same for everyone. */
export const EventosComoAdmin: Story = section("index", { joinRequests: true, reports: true });
export const EventosComoMembro: Story = section("index", { me: "caio" });
/** The people tab is the same for everyone: names, roles and "Denunciar". Roles and blocking are in the administration. */
export const PessoasComoAdmin: Story = section("people");
export const PessoasComoMembro: Story = section("people", { me: "caio" });
export const DenunciarComoMembro: Story = section(
  "people",
  { me: "caio" },
  {
    play: async ({ canvasElement }) => {
      const canvas = within(canvasElement);
      await userEvent.click(await canvas.findByTestId("report-duda"));
      await userEvent.click(await canvas.findByTestId("report-reason-harassment"));
    },
  },
);
export const EuComoAdmin: Story = section("me");
/** A member keeps the way to take over a lost coordination under "Avançado". */
export const EuComoMembro: Story = section("me", { me: "caio" });
/** An admin marked the community for deletion: banner for everyone, nothing can change. */
export const MarcadaParaExclusao: Story = section("index", { me: "caio", disabledBy: "ana" });
export const MarcadaParaExclusaoPessoas: Story = section("people", { me: "caio", disabledBy: "ana" });
export const SemConexao: Story = section("index", { connectivity: "offline", pending: 3 });
export const MudancaRecusada: Story = section("index", { rejections: [{ type: "participation.accept", reason: "capacity_full" }] });
/** Before the community is in there are no sections: the screen stands alone. */
export const AguardandoAprovacao: Story = screen(EventsRoute, "Pedido enviado", { entries: [makeEntry({ id: "c1", status: "joining" })], params: { id: "c1" } });
export const PedidoNaoAceito: Story = screen(EventsRoute, "Pedido não aceito", { entries: [makeEntry({ id: "c1", status: "rejected" })], params: { id: "c1" } });
