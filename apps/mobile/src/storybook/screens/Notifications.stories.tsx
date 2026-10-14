import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import NotificationsScreen from "../../app/c/[id]/notifications";
import { makeEntry, screen } from "./helpers";

const meta: Meta = { title: "Telas/Notificações", parameters: { layout: "fullscreen" } };
export default meta;
type Story = StoryObj;

const inbox = (o: Parameters<typeof makeEntry>[0] = {}): Story =>
  screen(NotificationsScreen, "Notificações", { entries: [makeEntry({ id: "c1", ...o })], params: { id: "c1" } });

/** Caio: mentioned by Bia, invited to the bandeiraço; nothing read yet. */
export const ComoCaioTudoNovo: Story = inbox({ me: "caio", noticesSince: 0 });
/** The same, after he looked at the older ones: only the mention is new. */
export const ComoCaioUmaNova: Story = inbox({ me: "caio", noticesSince: 14 });
/** Bia: Caio mentioned her; Ana handed her the leaflets. */
export const ComoBia: Story = inbox({ me: "bia", noticesSince: 0 });
/** Edu was never mentioned, assigned or invited. */
export const Vazia: Story = inbox({ me: "edu" });
