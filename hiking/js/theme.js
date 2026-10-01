// The combined site has one theme (dark, like the rest of the site), so there is no colours menu any more.
// The map code still asks whether the page is dark (to choose line colours and the dark map) and listens for 'themechange'.
export const currentTheme = () => 'dark';
export const isDark = () => true;
export const setTheme = () => {};
