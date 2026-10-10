import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import EventScreen from "../../app/c/[id]/event/[eid]";
import { makeEntry, screen } from "./helpers";

const meta: Meta = { title: "Telas/Evento", parameters: { layout: "fullscreen" } };
export default meta;
type Story = StoryObj;

const event = (eid: string, o: Parameters<typeof makeEntry>[0] = {}): Story =>
  screen(EventScreen, "Evento", { entries: [makeEntry({ id: "c1", ...o })], params: { id: "c1", eid } });

/** Duda foi convidada e a organização perguntou se ela pode ir. */
export const ConvitePendente: Story = event("e1", { me: "duda", incomingProbe: true });
export const VoluntariadoAguardando: Story = event("e1", { me: "caio" });
export const ConfirmadaComoMembro: Story = event("e1", { me: "bia" });
export const OrganizacaoVendoRespostas: Story = event("e1", { me: "ana", probeReplies: true });
export const Lotado: Story = event("e3", { me: "duda" });
export const Cancelado: Story = event("e4", { me: "ana" });
export const ConcluidoRegistrandoPresenca: Story = event("e5", { me: "ana" });
/** Admins and moderators can delete any event ("Apagar evento"). */
export const ApagarComoModeracao: Story = event("e2", { me: "duda", moderator: true });
export const ResumoDeEventoAntigo: Story = event("old1", { me: "ana" });
