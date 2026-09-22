"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

export default function PageMotion() {
  const pathname = usePathname();
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const elements = document.querySelectorAll<HTMLElement>(
      ".hero-copy, .hero-routine, .ranking-heading, .crew-stats > div, .benefit-grid > a, .page-heading, .auth-card, .discord-nudge, .community-manifest",
    );
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("motion-arrive");
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.12 },
    );
    elements.forEach((element, index) => {
      element.classList.remove("motion-arrive");
      element.style.setProperty(
        "--arrival-delay",
        `${Math.min(index % 4, 3) * 55}ms`,
      );
      observer.observe(element);
    });
    return () => observer.disconnect();
  }, [pathname]);
  return null;
}
