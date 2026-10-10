import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import Settings from "../../app/settings";
import { makeCalendar, screen } from "./helpers";

const meta: Meta = { title: "Telas/Ajustes", parameters: { layout: "fullscreen" } };
export default meta;
type Story = StoryObj;

export const SemAgendas: Story = screen(Settings, "Agendas · Lugares", { calendar: makeCalendar() });
export const AgendaEmLugares: Story = screen(Settings, "Agendas · Lugares", {
  calendar: makeCalendar({
    connected: ["device", "google"],
    places: [
      { id: "p1", label: "Casa", radiusKm: 10 },
      { id: "p2", label: "Viagem a Olinda", radiusKm: 5, activeFrom: Date.UTC(2026, 10, 2), activeTo: Date.UTC(2026, 10, 9) },
    ],
  }),
});
