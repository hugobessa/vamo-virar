import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import Community from "../../app/c/[id]/index";
import { makeEntry, openTab, screen } from "./helpers";

const meta: Meta = { title: "Telas/Comunidade", parameters: { layout: "fullscreen" } };
export default meta;
type Story = StoryObj;

const params = { id: "c1" };
const community = (o: Parameters<typeof makeEntry>[0] = {}, extra: Partial<Story> = {}): Story => ({
  ...screen(Community, "Horta da Vila", { entries: [makeEntry({ id: "c1", ...o })], params }),
  ...extra,
});

export const EventosComoAdmin: Story = community();
export const EventosComoMembro: Story = community({ me: "caio" });
export const PessoasComoAdmin: Story = community({ joinRequests: true }, { play: openTab("Pessoas") });
export const PessoasComoMembro: Story = community({ me: "caio" }, { play: openTab("Pessoas") });
export const EuComoAdmin: Story = community({}, { play: openTab("Eu") });
export const EuComoMembro: Story = community({ me: "caio" }, { play: openTab("Eu") });
export const SemConexao: Story = community({ connectivity: "offline", pending: 3 });
export const MudancaRecusada: Story = community({ rejections: [{ type: "participation.accept", reason: "capacity_full" }] });
export const AguardandoAprovacao: Story = community({ status: "joining" });
export const PedidoNaoAceito: Story = community({ status: "rejected" });
