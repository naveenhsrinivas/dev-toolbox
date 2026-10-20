// Apply a saved theme before first paint, to avoid a flash of the wrong colours.
try {
  const t = localStorage.getItem("theme");
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
} catch {
  // Storage blocked: follow the system theme.
}
