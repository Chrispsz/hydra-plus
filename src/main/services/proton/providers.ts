import type { ProtonProvider } from "@types";

/**
 * Declarative registry of Proton build providers (GitHub release sources).
 *
 * Adding a new provider is a single data entry: the release discovery,
 * download, verification and installation pipeline is provider-agnostic
 * and only needs `repo` plus an asset-name convention compatible with
 * `matchesReleaseAsset` (asset stem equal to the tag, optionally with a
 * `-x86_64` variant suffix).
 *
 * NOTE (follow-up): CachyOS also publishes v3/v4 build variant assets
 * (`<tag>-v3-x86_64`); variant matching is intentionally out of scope for
 * now — only the default x86_64 asset is offered.
 */
export interface ProtonProviderDefinition {
  id: string;
  name: string;
  repo: string;
  description?: string;
}

export const PROTON_PROVIDERS: readonly ProtonProviderDefinition[] = [
  {
    id: "ge-proton",
    name: "GE-Proton",
    repo: "GloriousEggroll/proton-ge-custom",
    description:
      "Community Proton build by GloriousEggroll with extra fixes and patches",
  },
  {
    id: "proton-cachyos",
    name: "Proton CachyOS",
    repo: "CachyOS/proton-cachyos",
  },
];

export const getProtonProviderById = (
  providerId: string
): ProtonProviderDefinition | null => {
  return (
    PROTON_PROVIDERS.find((provider) => provider.id === providerId) ?? null
  );
};

export const toProtonProviderList = (): ProtonProvider[] =>
  PROTON_PROVIDERS.map((provider) => ({
    id: provider.id,
    name: provider.name,
    repo: provider.repo,
    ...(provider.description ? { description: provider.description } : {}),
  }));
