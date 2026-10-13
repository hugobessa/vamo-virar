// Stand-in for expo-router in stories: navigation is logged, route params come from the scenario.
import { cloneElement, isValidElement, useEffect, type ReactNode } from "react";
import { action } from "storybook/actions";
import { useHeaderTitle } from "./Phone";
import { useScenario } from "./scenario";

export const router = {
  push: action("router.push"),
  replace: action("router.replace"),
  back: action("router.back"),
};

export function useLocalSearchParams<T extends Record<string, string>>(): Partial<T> {
  return useScenario().params as Partial<T>;
}

/** The path of the story's screen: the community's section, when the params name one. */
export function usePathname(): string {
  const s = useScenario();
  if (s.pathname) return s.pathname;
  const id = s.params["id"];
  if (!id) return "/";
  return s.tab && s.tab !== "index" ? `/c/${id}/${s.tab}` : `/c/${id}`;
}

/** A link that logs where it would go; with `asChild` the child does the rendering. */
export function Link({ href, children }: { href: unknown; asChild?: boolean; children: ReactNode }) {
  const go = () => router.push(href);
  return isValidElement<{ onPress?: () => void }>(children) ? cloneElement(children, { onPress: go }) : <>{children}</>;
}

/** `<Stack.Screen options>` reaches the frame's header: its title, and a button on the right. */
function Screen({ options }: { options?: { title?: string; headerRight?: () => ReactNode } }) {
  const setHeader = useHeaderTitle();
  const title = options?.title;
  const right = options?.headerRight;
  useEffect(() => {
    setHeader({ title, right: right?.() });
  }, [title, right, setHeader]);
  return null;
}

export function Stack({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}
Stack.Screen = Screen;
