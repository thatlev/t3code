import type { ServerProviderSkill } from "@t3tools/contracts";

export const FRONTEND_MAX_SKILL: ServerProviderSkill = {
  name: "frontend-max",
  displayName: "Frontend Max",
  shortDescription: "Run T3's complete frontend design, polish, and quality workflow.",
  description:
    "Design and implement the frontend with strong visual direction, accessibility, responsive behavior, interaction polish, and performance validation.",
  path: "app://builtin-skills/frontend-max",
  scope: "app",
  enabled: true,
};

const FRONTEND_MAX_PROMPT = [
  "Apply the Frontend Max workflow to this request.",
  "Establish an intentional visual direction; implement the UI cleanly and responsively;",
  "polish hierarchy, typography, spacing, states, motion, accessibility, and keyboard behavior;",
  "then review the result against modern web-interface and performance best practices.",
  "Preserve the product's existing design language unless the request explicitly calls for a redesign.",
].join(" ");

export function withBuiltinSkills(
  skills: ReadonlyArray<ServerProviderSkill>,
): ReadonlyArray<ServerProviderSkill> {
  return skills.some((skill) => skill.name === FRONTEND_MAX_SKILL.name)
    ? skills
    : [FRONTEND_MAX_SKILL, ...skills];
}

export function expandBuiltinSkills(text: string): string {
  return text.replace(/\$frontend-max\b/giu, FRONTEND_MAX_PROMPT);
}
