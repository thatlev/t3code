import { createFileRoute } from "@tanstack/react-router";

import { CodexMicroSettings } from "../components/settings/CodexMicroSettings";

export const Route = createFileRoute("/settings/codex-micro")({
  component: CodexMicroSettings,
});
