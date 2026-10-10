import { action } from "storybook/actions";

/** Always says yes, and logs the question to the Actions panel. */
export function confirm(message: string): Promise<boolean> {
  action("confirm")(message);
  return Promise.resolve(true);
}
