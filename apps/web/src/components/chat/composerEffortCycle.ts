import type {
  ProviderDriverKind,
  ProviderOptionDescriptor,
  ProviderOptionSelection,
  ServerProviderModel,
} from "@t3tools/contracts";
import {
  buildProviderOptionSelectionsFromDescriptors,
  getProviderOptionCurrentValue,
  getProviderOptionDescriptors,
} from "@t3tools/shared/model";

import { getProviderModelCapabilities } from "../../providerModels";

export type ReasoningEffortCycle = {
  /** Descriptor id that was stepped (`reasoningEffort`, `effort`, …). */
  readonly descriptorId: string;
  /** Choice id now selected. */
  readonly value: string;
  /** Full option selection list to persist for the composer draft. */
  readonly options: ReadonlyArray<ProviderOptionSelection>;
};

/**
 * Step the model's primary reasoning control one notch.
 *
 * The control is whatever the *server* declares as the first `select` option
 * descriptor for the selected model — the same descriptor the Traits picker
 * renders as "Reasoning". Its id differs per provider (Codex reports
 * `reasoningEffort`, Claude reports `effort`) and the available levels come
 * from the live model catalog, so nothing here may be hard-coded: writing a
 * selection whose id is not a declared descriptor is silently dropped both by
 * the composer UI and by dispatch, which is exactly a dial that "does nothing".
 *
 * Choices that are applied by injecting text into the prompt (Claude's
 * Ultrathink) are skipped — the dial only moves controls that live in the
 * model selection.
 */
export function cycleProviderReasoningEffort(input: {
  provider: ProviderDriverKind;
  model: string;
  models: ReadonlyArray<ServerProviderModel>;
  modelOptions: ReadonlyArray<ProviderOptionSelection> | null | undefined;
  direction: -1 | 1;
}): ReasoningEffortCycle | null {
  const caps = getProviderModelCapabilities(input.models, input.model, input.provider);
  const descriptors = getProviderOptionDescriptors({ caps, selections: input.modelOptions });
  const primary = descriptors.find(
    (descriptor): descriptor is Extract<ProviderOptionDescriptor, { type: "select" }> =>
      descriptor.type === "select",
  );
  if (!primary) return null;

  const promptInjected = new Set(primary.promptInjectedValues ?? []);
  const choices = primary.options.filter((choice) => !promptInjected.has(choice.id));
  if (choices.length === 0) return null;

  const currentValue = getProviderOptionCurrentValue(primary);
  const currentIndex =
    typeof currentValue === "string"
      ? choices.findIndex((choice) => choice.id === currentValue)
      : -1;
  const defaultIndex = choices.findIndex((choice) => choice.isDefault === true);
  const baseIndex = currentIndex >= 0 ? currentIndex : Math.max(0, defaultIndex);
  const nextIndex = Math.min(choices.length - 1, Math.max(0, baseIndex + input.direction));
  const next = choices[nextIndex];
  if (!next) return null;

  const nextDescriptors = descriptors.map((descriptor) =>
    descriptor.id === primary.id && descriptor.type === "select"
      ? { ...descriptor, currentValue: next.id }
      : descriptor,
  );
  const options = buildProviderOptionSelectionsFromDescriptors(nextDescriptors);
  if (!options) return null;

  return { descriptorId: primary.id, value: next.id, options };
}
