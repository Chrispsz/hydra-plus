/**
 * Runtime path-alias resolver hook for chain tests.
 *
 * ts-node/esm does not apply the tsconfig `paths` mapping to ESM
 * specifiers, so production modules whose RUNTIME imports use the
 * `@main/*` / `@shared/*` aliases (e.g. resolve-launch-command.ts →
 * `@main/events/helpers/parse-launch-options`) cannot be statically
 * imported by the headless test runner. Chain tests register() this hook
 * right before dynamically importing such a module: every future dynamic
 * import resolves the two aliases to real files under src/ and delegates
 * everything else to the ts-node loader unchanged. The full rationale
 * lives in the headless-boundaries header of proton-chain.test.ts.
 */
import { pathToFileURL } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

const ALIAS_ROUTES = [
  ["@main/", "src/main/"],
  ["@shared/", "src/shared/"],
];

const tsExtensionFor = (specifier) =>
  specifier.endsWith(".js")
    ? `${specifier.slice(0, -3)}.ts`
    : `${specifier}.ts`;

export async function resolve(specifier, context, nextResolve) {
  for (const [prefix, target] of ALIAS_ROUTES) {
    if (specifier.startsWith(prefix)) {
      const rest = specifier.slice(prefix.length);
      const filePath = path.join(repoRoot, target, tsExtensionFor(rest));
      return nextResolve(pathToFileURL(filePath).href, context);
    }
  }
  return nextResolve(specifier, context);
}
