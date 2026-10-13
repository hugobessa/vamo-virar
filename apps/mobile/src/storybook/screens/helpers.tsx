import type { ComponentType } from "react";
import { userEvent, within } from "storybook/test";
import { Phone } from "../Phone";
import { communityState, makeCalendar, makeEntry, type EntryOptions, type Scenario } from "../scenario";

/** Renders a real screen inside the phone frame with mock data. */
export function screen(Component: ComponentType, title: string, scenario: Partial<Scenario> = {}) {
  return { render: () => (
    <Phone title={title} scenario={scenario}>
      <Component />
    </Phone>
  ) };
}

/** Community entry with its own name. */
export function entryNamed(name: string, o: EntryOptions = {}) {
  const state = communityState();
  state.community.name = name;
  return makeEntry({ ...o, state });
}

/** Clicks a tab (of the community screen, the board or the administration), like a person would. A regexp ignores a count after the label. */
export const openTab = (label: string | RegExp) => async ({ canvasElement }: { canvasElement: HTMLElement }) => {
  await userEvent.click(await within(canvasElement).findByRole("tab", { name: label }));
};

export { makeCalendar, makeEntry };
