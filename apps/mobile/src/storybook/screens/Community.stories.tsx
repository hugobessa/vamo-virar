import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import Community from "../../app/c/[id]/index";
import { userEvent, within } from "storybook/test";
import { COMMUNITY_NAME } from "../scenario";
import { makeEntry, openTab, screen } from "./helpers";

const meta: Meta = { title: "Telas/Comunidade", parameters: { layout: "fullscreen" } };
export default meta;
type Story = StoryObj;

const params = { id: "c1" };
const community = (o: Parameters<typeof makeEntry>[0] = {}, extra: Partial<Story> = {}): Story => ({
  ...screen(Community, COMMUNITY_NAME, { entries: [makeEntry({ id: "c1", ...o })], params }),
  ...extra,
});

export const EventosComoAdmin: Story = community();
export const EventosComoMembro: Story = community({ me: "caio" });
export const PessoasComoAdmin: Story = community({ joinRequests: true }, { play: openTab("Pessoas") });
export const DenunciasComoAdmin: Story = community({ reports: true }, { play: openTab("Pessoas") });
export const PessoasComoModeracao: Story = community({ me: "duda", moderator: true, reports: true, joinRequests: true }, { play: openTab("Pessoas") });
export const PessoasComoMembro: Story = community({ me: "caio" }, { play: openTab("Pessoas") });
export const DenunciarComoMembro: Story = community(
  { me: "caio" },
  {
    play: async (ctx) => {
      await openTab("Pessoas")(ctx);
      const canvas = within(ctx.canvasElement);
      await userEvent.click(await canvas.findByTestId("report-duda"));
      await userEvent.click(await canvas.findByTestId("report-reason-harassment"));
    },
  },
);
export const EuComoAdmin: Story = community({}, { play: openTab("Eu") });
export const EuComoMembro: Story = community({ me: "caio" }, { play: openTab("Eu") });
/** An admin marked the community for deletion: banner for everyone, nothing can change. */
export const MarcadaParaExclusao: Story = community({ me: "caio", disabledBy: "ana" });
export const MarcadaParaExclusaoPessoas: Story = community({ me: "caio", disabledBy: "ana" }, { play: openTab("Pessoas") });
/** Ana (admin) can disable it from the "Eu" tab: see EuComoAdmin. Another admin sees "Reativar". */
export const ReativarComoOutraAdmin: Story = community({ me: "ana", secondAdmin: true, disabledBy: "bia" }, { play: openTab("Eu") });
/** The admin who disabled it cannot re-enable it. */
export const DesativadaPorMim: Story = community({ me: "ana", secondAdmin: true, disabledBy: "ana" }, { play: openTab("Eu") });
export const SemConexao: Story = community({ connectivity: "offline", pending: 3 });
export const MudancaRecusada: Story = community({ rejections: [{ type: "participation.accept", reason: "capacity_full" }] });
export const AguardandoAprovacao: Story = community({ status: "joining" });
export const PedidoNaoAceito: Story = community({ status: "rejected" });
