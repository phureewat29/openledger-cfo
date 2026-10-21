/**
 * One value per process rather than per module graph. Next evaluates server
 * modules once for the server components and again for the route handlers, and
 * again on every HMR pass, so a plain module constant splits into copies that
 * never see each other. The slot on `globalThis` is the one place they share.
 */
export const perProcess = <T>(key: string, create: () => T): T => {
  const slots = globalThis as unknown as Record<string, T | undefined>;
  return (slots[key] ??= create());
};
