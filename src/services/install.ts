type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};
let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((fn) => fn());
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferred = event as InstallPromptEvent;
  changed();
});
window.addEventListener("appinstalled", () => {
  deferred = null;
  changed();
});
export function standalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator &&
      Boolean((navigator as Navigator & { standalone?: boolean }).standalone))
  );
}
export function canPromptInstall() {
  return Boolean(deferred) && !standalone();
}
export function isIOS() {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}
export function watchInstall(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
export async function promptInstall() {
  if (!deferred) return false;
  const event = deferred;
  await event.prompt();
  const choice = await event.userChoice;
  if (choice.outcome === "accepted") deferred = null;
  changed();
  return choice.outcome === "accepted";
}
