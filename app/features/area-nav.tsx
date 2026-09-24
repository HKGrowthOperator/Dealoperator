"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Kleine Bereichsnavigation unter dem Seitentitel (nicht fest, keine zweite
 * Leiste). „mine“: der eigene Bereich. „exchange“: Reflexionen, Sessions
 * und Wissen. Call-Partner ist ein eigener Reiter im Kopf.
 */
const AREAS = {
  mine: {
    label: "Mein Bereich",
    items: [
      { path: "/tagesabschluss", href: "/tagesabschluss", label: "Mein Tag" },
      { path: "/heute", href: "/heute?modus=eigen", label: "Fortschritt" },
      { path: "/zahlen", href: "/zahlen?modus=eigen", label: "Zahlen" },
      { path: "/profil", href: "/profil?modus=eigen", label: "Profil" },
    ],
  },
  exchange: {
    label: "Austausch",
    items: [
      { path: "/reflexionen", href: "/reflexionen", label: "Reflexionen" },
      { path: "/sessions", href: "/sessions?modus=eigen", label: "Sessions" },
      { path: "/wissen", href: "/wissen?modus=eigen", label: "Wissen" },
    ],
  },
} as const;

export default function AreaNav({ area }: { area: keyof typeof AREAS }) {
  const path = usePathname() || "";
  const { label, items } = AREAS[area];
  return (
    <nav className="do-area-nav" data-area={area} aria-label={label}>
      {items.map((item) => (
        <Link
          key={item.path}
          href={item.href}
          aria-current={path === item.path ? "page" : undefined}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
