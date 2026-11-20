/** The header gear carries this id; it exists in every app state. */
export const SETTINGS_TRIGGER_ID = "ai-gateway-settings";

const isOnScreen = (element: HTMLElement): boolean => {
  const rect = element.getBoundingClientRect();
  return rect.left < window.innerWidth && rect.right > 0;
};

/** Focus fallback when the trigger is gone: the gear if visible (below `lg` it parks in a drawer), else main. */
export const settleFocus = (): void => {
  requestAnimationFrame(() => {
    const gear = document.getElementById(SETTINGS_TRIGGER_ID);
    const target =
      gear !== null && isOnScreen(gear)
        ? gear
        : document.getElementById("main");
    target?.focus();
  });
};
