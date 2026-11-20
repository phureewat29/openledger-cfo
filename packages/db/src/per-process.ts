// Next evaluates server modules per graph and per HMR pass, so a module constant splits into
// copies that never see each other; a `globalThis` slot is the one place they share.
export const perProcess = <T>(key: string, create: () => T): T => {
  const slots = globalThis as unknown as Record<string, T | undefined>;
  return (slots[key] ??= create());
};
