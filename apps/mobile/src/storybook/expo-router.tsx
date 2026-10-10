// Stand-in for expo-router in stories: navigation is logged, route params come from the scenario.
import { useEffect, type ReactNode } from "react";
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
