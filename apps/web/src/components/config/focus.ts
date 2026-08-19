/** The header gear carries this id; it exists in every app state. */
export const SETTINGS_TRIGGER_ID = "ai-gateway-settings";

/**
 * Where focus lands when its trigger is gone (or about to be): the gear when
 * it is actually on screen — below `lg` it sits inside a parked drawer — else
 * the main region.
 */
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
