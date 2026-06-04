# Tailwind Config Additions

Merge these into your existing `tailwind.config.ts` under `theme.extend`.

## Colors

The `nurock` palette gains five tokens (`navy-light`, `tan-light`, `tan-dark`,
`slate-light`, `border`) on top of what's already there.

```ts
extend: {
  colors: {
    nurock: {
      navy: "#164576",
      "navy-dark": "#0F3557",
      "navy-light": "#1E5A94",     // NEW
      tan: "#B4AE92",
      "tan-light": "#C9C3A8",       // NEW
      "tan-dark": "#8F8A6F",        // NEW
      black: "#101828",
      slate: "#475467",
      "slate-light": "#667085",     // NEW
      gray: "#F4F4F4",
      offwhite: "#F2F2F2",
      border: "#E4E7EC",            // NEW — standard border
    },
  },
  fontFamily: {
    display: ["Oswald", "ui-sans-serif", "system-ui"],
    body:    ["Inter", "ui-sans-serif", "system-ui"],
    mono:    ["JetBrains Mono", "ui-monospace", "monospace"],  // NEW
  },
},
```

## Font loading

The `nurock-devmgmt` app already loads Oswald + Inter. Add JetBrains Mono to
`src/app/layout.tsx`:

```tsx
import { Oswald, Inter, JetBrains_Mono } from "next/font/google";

const oswald = Oswald({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-oswald",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-inter",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-jetbrains",
});

// In your <html> or <body> tag:
<html className={`${oswald.variable} ${inter.variable} ${jetbrains.variable}`}>
```

Then in `globals.css`, ensure the `.font-mono` helper references the variable:

```css
.font-mono { font-family: var(--font-jetbrains), ui-monospace, monospace; }
```

(The fallback chain in the helper classes works without this — but using the
Next.js font variable gets you the optimized font loading.)
