"use client";

import { useEffect } from "react";

/** スクロール出現の検知だけを担当。JS・Observerなしでも本文は表示する。 */
export default function HomeReveal() {
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const sections = document.querySelectorAll<HTMLElement>("[data-home-reveal]");
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const section = entry.target as HTMLElement;
        section.removeAttribute("data-reveal-pending");
        section.classList.add("home-revealed");
        observer.unobserve(section);
      }
    }, { threshold: 0.08 });

    sections.forEach(section => {
      section.setAttribute("data-reveal-pending", "");
      observer.observe(section);
    });
    return () => {
      observer.disconnect();
      sections.forEach(section => {
        section.removeAttribute("data-reveal-pending");
        section.classList.remove("home-revealed");
      });
    };
  }, []);

  return null;
}
