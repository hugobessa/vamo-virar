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

/** The path of the story's screen: the community's, when the params name one. */
export function usePathname(): string {
  const s = useScenario();
  return s.pathname ?? (s.params["id"] ? `/c/${s.params["id"]}` : "/");
}

/** A link that logs where it would go; with `asChild` the child does the rendering. */
export function Link({ href, children }: { href: unknown; asChild?: boolean; children: ReactNode }) {
  const go = () => router.push(href);
  return isValidElement<{ onPress?: () => void }>(children) ? cloneElement(children, { onPress: go }) : <>{children}</>;
}

function Screen({ options }: { options?: { title?: string } }) {
  const setTitle = useHeaderTitle();
  const title = options?.title;
  useEffect(() => {
    if (title) setTitle(title);
  }, [title, setTitle]);
  return null;
}

export function Stack({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}
Stack.Screen = Screen;
