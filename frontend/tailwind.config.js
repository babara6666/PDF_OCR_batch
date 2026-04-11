/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Light mode tokens
        "background":                "#F9F9F4",
        "surface":                   "#FFFFFF",
        "surface-container-lowest":  "#FFFFFF",
        "surface-container-low":     "#F4F4EE",
        "surface-container":         "#F1F1EB",
        "surface-container-high":    "#EBEBE5",
        "surface-container-highest": "#E4E4DE",
        "on-background":             "#2C3E50",
        "on-surface":                "#2C3E50",
        "on-surface-variant":        "#5D6D7E",
        "primary":                   "#8D9965",
        "on-primary":                "#FFFFFF",
        "primary-container":         "#DCE3C8",
        "on-primary-container":      "#1A1C16",
        "secondary":                 "#5D6D7E",
        "on-secondary":              "#FFFFFF",
        "tertiary":                  "#DCC497",
        "outline-variant":           "#E0E0DA",
        "outline":                   "#BDBDB4",
        "error":                     "#BA1A1A",
        "error-container":           "#F9DEDC",
      },
      fontFamily: {
        "headline": ["Noto Serif JP", "serif"],
        "body":     ["Manrope", "sans-serif"],
        "label":    ["Manrope", "sans-serif"],
        "mono":     ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
}
