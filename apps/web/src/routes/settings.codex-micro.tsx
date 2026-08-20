import { createFileRoute } from "@tanstack/react-router";

import { AgentMicroSettings } from "../components/settings/AgentMicroSettings";

export const Route = createFileRoute("/settings/codex-micro")({
  component: AgentMicroSettings,
});
