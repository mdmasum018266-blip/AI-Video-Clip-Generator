import bgGameplayRunner from "../assets/images/bg_gameplay_runner_1795261138551.jpg";
import bgSatisfyingAsmr from "../assets/images/bg_satisfying_asmr_1795261139392.jpg";
import demoCreatorEditing from "../assets/images/demo_creator_editing_1795261138677.jpg";
import demoFounderKeynote from "../assets/images/demo_founder_keynote_1795261139401.jpg";
import demoPodcastAi from "../assets/images/demo_podcast_ai_1795261139145.jpg";
import demoTravelVlog from "../assets/images/demo_travel_vlog_1795261138763.jpg";

export const ASSET_IMAGES = {
  bgGameplayRunner,
  bgSatisfyingAsmr,
  demoCreatorEditing,
  demoFounderKeynote,
  demoPodcastAi,
  demoTravelVlog,
} as const;

const LEGACY_ASSET_MAP: Record<string, string> = {
  "/src/assets/images/bg_gameplay_runner_1795261138551.jpg": bgGameplayRunner,
  "/src/assets/images/bg_satisfying_asmr_1795261139392.jpg": bgSatisfyingAsmr,
  "/src/assets/images/demo_creator_editing_1795261138677.jpg": demoCreatorEditing,
  "/src/assets/images/demo_founder_keynote_1795261139401.jpg": demoFounderKeynote,
  "/src/assets/images/demo_podcast_ai_1795261139145.jpg": demoPodcastAi,
  "/src/assets/images/demo_travel_vlog_1795261138763.jpg": demoTravelVlog,
};

/**
 * Resolves legacy "/src/assets/images/..." paths stored in localStorage or Firestore
 * to Vite-bundled production asset URLs.
 */
export function normalizeAssetUrl(
  url: string | undefined,
  fallback: string = demoCreatorEditing
): string {
  if (!url) return fallback;
  const trimmed = url.trim();
  if (!trimmed) return fallback;
  if (LEGACY_ASSET_MAP[trimmed]) {
    return LEGACY_ASSET_MAP[trimmed];
  }
  if (trimmed.startsWith("/src/assets/images/")) {
    const filename = trimmed.split("/").pop() || "";
    const matched = Object.entries(LEGACY_ASSET_MAP).find(([k]) => k.endsWith(`/${filename}`));
    if (matched) return matched[1];
    return fallback;
  }
  return trimmed;
}
