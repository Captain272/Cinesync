export type LanguageCode = "te" | "hi" | "ta" | "ml" | "kn" | "bn" | "en";

export const INDIAN_LANGUAGES: { code: LanguageCode; name: string }[] = [
  { code: "te", name: "Telugu" },
  { code: "hi", name: "Hindi" },
  { code: "ta", name: "Tamil" },
  { code: "ml", name: "Malayalam" },
  { code: "kn", name: "Kannada" },
  { code: "bn", name: "Bengali" },
  { code: "en", name: "English" },
];

export function languageName(code: string | null | undefined): string {
  if (!code) return "";
  return INDIAN_LANGUAGES.find((l) => l.code === code)?.name ?? code.toUpperCase();
}
