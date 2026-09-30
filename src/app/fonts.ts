import { Bricolage_Grotesque, Instrument_Sans, Space_Mono } from "next/font/google";

// Families and weights from BEAM_DESIGN_LANGUAGE.md section 2.1, self-hosted by next/font.
export const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  axes: ["opsz"],
  display: "swap",
  variable: "--font-bricolage",
});

export const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-instrument",
});

export const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
  variable: "--font-space-mono",
});
