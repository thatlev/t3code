import { createFileRoute } from "@tanstack/react-router";

import { AgentMicroSettings } from "../components/settings/AgentMicroSettings";

export const Route = createFileRoute("/settings/agent-micro")({
  component: AgentMicroSettings,
});
