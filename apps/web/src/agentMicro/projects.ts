/**
 * AgentMicro advertises the environment's projects so the phone can ask
 * "which project?" before starting a new chat. Project ids are only unique
 * inside one environment, so they travel over the wire scoped the same way
 * thread targets are (`environmentId|projectId`, both components percent
 * encoded so the separator can never appear inside a component).
 */
export function encodeAgentMicroProject(environmentId: string, projectId: string): string {
  return `${encodeURIComponent(environmentId)}|${encodeURIComponent(projectId)}`;
}

export function decodeAgentMicroProject(
  value: string,
): { environmentId: string; projectId: string } | null {
  const separator = value.indexOf("|");
  if (separator < 1 || separator === value.length - 1) return null;
  try {
    return {
      environmentId: decodeURIComponent(value.slice(0, separator)),
      projectId: decodeURIComponent(value.slice(separator + 1)),
    };
  } catch {
    return null;
  }
}
