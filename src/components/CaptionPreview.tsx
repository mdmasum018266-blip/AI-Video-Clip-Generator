import React from "react";
import { CaptionStyleId } from "../types";

interface CaptionPreviewProps {
  styleId: CaptionStyleId;
  text: string;
  emphasisWords?: string[];
  activeWordIndex?: number;
  compact?: boolean;
}

export const CaptionPreview: React.FC<CaptionPreviewProps> = ({
  styleId,
  text,
  emphasisWords = [],
  activeWordIndex = -1,
  compact = false,
}) => {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const emphasisSet = new Set(
    emphasisWords
      .map((w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""))
      .filter(Boolean)
  );

  const isHighlighted = (word: string, idx: number) => {
    if (activeWordIndex >= 0 && idx === activeWordIndex) return true;
    const clean = word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    return clean.length > 0 && emphasisSet.has(clean);
  };

  if (styleId === "minimal-serif") {
    return (
      <div
        className={`inline-block rounded-md bg-black/75 backdrop-blur-sm px-3 py-1.5 text-center ${
          compact ? "text-[11px]" : "text-sm"
        } font-medium text-white leading-snug shadow-lg`}
      >
        {words.map((w, i) => (
          <span
            key={i}
            className={`mr-1 inline-block transition-colors duration-150 ${
              isHighlighted(w, i) ? "text-amber-300 font-semibold" : "text-white"
            }`}
          >
            {w}
          </span>
        ))}
      </div>
    );
  }

  return (
    <div
      className={`text-center leading-tight tracking-tight select-none ${
        compact ? "text-[11px]" : "text-base sm:text-lg"
      }`}
    >
      {words.map((word, idx) => {
        const active = isHighlighted(word, idx);

        if (styleId === "classic") {
          return (
            <span
              key={idx}
              className={`mr-1.5 inline-block font-extrabold uppercase transition-transform duration-150 ${
                active
                  ? "text-amber-400 scale-105"
                  : "text-white"
              }`}
              style={{
                textShadow: "0 2px 6px rgba(0,0,0,0.95), 0 0 2px rgba(0,0,0,0.95)",
              }}
            >
              {word}
            </span>
          );
        }

        if (styleId === "cyan-slide") {
          return (
            <span
              key={idx}
              className={`mr-1 inline-block font-extrabold uppercase px-1 rounded transition-transform duration-150 ${
                active
                  ? "bg-cyan-400 text-zinc-950 scale-105"
                  : "text-white"
              }`}
              style={{
                textShadow: active ? "none" : "0 2px 6px rgba(0,0,0,0.95)",
              }}
            >
              {word}
            </span>
          );
        }

        if (styleId === "italic-red") {
          return (
            <span
              key={idx}
              className={`mr-1.5 inline-block font-extrabold italic uppercase transition-transform duration-150 ${
                active ? "text-red-500 scale-105" : "text-white"
              }`}
              style={{
                textShadow: "0 2px 8px rgba(0,0,0,0.95)",
              }}
            >
              {word}
            </span>
          );
        }

        if (styleId === "red-spin") {
          return (
            <span
              key={idx}
              className={`mr-1 inline-block font-extrabold uppercase px-1.5 py-0.5 rounded transition-transform duration-150 ${
                active
                  ? "bg-red-600 text-white -rotate-1 scale-105 shadow-md"
                  : "text-white"
              }`}
              style={{
                textShadow: active ? "none" : "0 2px 6px rgba(0,0,0,0.95)",
              }}
            >
              {word}
            </span>
          );
        }

        if (styleId === "violet") {
          return (
            <span
              key={idx}
              className={`mr-1.5 inline-block font-extrabold uppercase transition-transform duration-150 ${
                active ? "text-violet-400 scale-105" : "text-white"
              }`}
              style={{
                textShadow: active
                  ? "0 0 12px rgba(167,139,250,0.7), 0 2px 6px rgba(0,0,0,0.95)"
                  : "0 2px 6px rgba(0,0,0,0.95)",
              }}
            >
              {word}
            </span>
          );
        }

        if (styleId === "blue-glow") {
          return (
            <span
              key={idx}
              className={`mr-1.5 inline-block font-bold transition-transform duration-150 ${
                active ? "text-blue-400 uppercase scale-105" : "text-zinc-100 lowercase"
              }`}
              style={{
                textShadow: active
                  ? "0 0 14px rgba(59,130,246,0.85), 0 2px 6px rgba(0,0,0,0.95)"
                  : "0 2px 6px rgba(0,0,0,0.95)",
              }}
            >
              {word}
            </span>
          );
        }

        // emerald-pop
        return (
          <span
            key={idx}
            className={`mr-1.5 inline-block font-extrabold uppercase transition-transform duration-150 ${
              active ? "text-emerald-400 scale-105" : "text-white"
            }`}
            style={{
              textShadow: "0 2px 6px rgba(0,0,0,0.95)",
            }}
          >
            {word}
          </span>
        );
      })}
    </div>
  );
};
