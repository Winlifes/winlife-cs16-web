const movementKeys = ["w", "a", "s", "d", "r"];
export const fullscreenGameKeys = ["KeyW", "KeyA", "KeyS", "KeyD", "KeyR", "F4", "F5", "Escape"];

/** Cancel the browser action while still delivering crouched movement to SDL. */
export function protectGameShortcut(event: KeyboardEvent, playing: boolean): boolean {
    if (event.altKey || event.isComposing) return false;
    const key = event.key.toLowerCase();
    const modified = event.ctrlKey || event.metaKey;
    const leaving = key === "f5" || (modified && ["w", "r", "f4"].includes(key));
    const gameInput = playing && event.ctrlKey && !event.metaKey && movementKeys.includes(key);
    if (!leaving && !gameInput) return false;

    event.preventDefault();
    if (gameInput) return false;
    event.stopImmediatePropagation();
    return true;
}
