/** The header gear carries this id; it exists in every app state. */
export const SETTINGS_TRIGGER_ID = "ai-gateway-settings";

/** Focus fallback when the trigger is gone: the gear if visible (below `lg` it parks in a drawer), else main. */
export const settleFocus = (): void => {
  requestAnimationFrame(() => {
    const gear = document.getElementById(SETTINGS_TRIGGER_ID);
    if (gear) {
      const rect = gear.getBoundingClientRect();
      if (rect.left < window.innerWidth && rect.right > 0) {
        gear.focus();
        return;
      }
    }
    document.getElementById("main")?.focus();
  });
};
