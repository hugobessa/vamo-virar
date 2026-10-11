// Real <a> elements for the landing page (web only): crawlable, middle-clickable
// and announced as links, which a Pressable with an onPress is not.

import { createElement, type CSSProperties, type ReactNode } from "react";
import { ButtonFace, type ButtonKind } from "../kit";
import { fonts, useTheme } from "../theme";

const external = (href: string) => /^https?:\/\//.test(href);

export function Anchor({ href, children, style, label, className }: { href: string; children: ReactNode; style?: CSSProperties; label?: string; className?: string }) {
  return createElement(
    "a",
    {
      href,
      className,
      "aria-label": label,
      style: { color: "inherit", textDecoration: "none", cursor: "pointer", ...style },
      ...(external(href) ? { target: "_blank", rel: "noopener noreferrer" } : {}),
    },
    children,
  );
}

/** Text link: underlined, in the text face. */
export function TextLink({ href, children, color, size = 15, bold = true, underline = true }: { href: string; children: ReactNode; color?: string; size?: number; bold?: boolean; underline?: boolean }) {
  const c = useTheme();
  return (
    <Anchor
      href={href}
      style={{
        color: color ?? c.text,
        fontFamily: fonts.text as string,
        fontSize: size,
        fontWeight: bold ? 700 : 400,
        textDecoration: underline ? "underline" : "none",
        display: "inline-block",
        padding: "10px 0",
      }}
    >
      {children}
    </Anchor>
  );
}

/** A link that looks like a button: its face sinks onto the depth edge while pressed (motion.css). */
export function LinkButton({ href, label, kind = "primary" }: { href: string; label: string; kind?: ButtonKind }) {
  return (
    <Anchor href={href} className="vv-btn" style={{ display: "block" }}>
      <ButtonFace label={label} kind={kind} />
    </Anchor>
  );
}
