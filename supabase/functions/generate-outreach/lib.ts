// Pure helpers used by index.ts, pulled out into their own module so they're
// testable without spinning up Deno.serve or hitting the OpenAI API. See
// lib.test.ts.

const KOSTIC_GRADNJA_URL = "https://kosticgradnja.hr/";

export type Channel = "viber" | "instagram" | "email" | "telefon";

export interface ClientInput {
  name: string;
  company: string;
  category: string;
  source: string;
  website: string;
  notes: string;
}

// Viber and Instagram share the same short-DM style; email and landline
// calls each have their own shape. An unknown/empty channel falls back to
// viber.
export function resolveChannel(rawChannel: unknown): Channel {
  if (rawChannel === "email") return "email";
  if (rawChannel === "telefon_fiksni") return "telefon";
  if (rawChannel === "instagram") return "instagram";
  return "viber";
}

export function buildUserPrompt(client: ClientInput): string {
  const lines: string[] = [];
  if (client.company) lines.push(`Firma: ${client.company}`);
  if (client.name) lines.push(`Kontakt osoba: ${client.name}`);
  if (client.category) lines.push(`Delatnost/lokacija: ${client.category}`);
  if (client.source) lines.push(`Izvor kontakta: ${client.source}`);
  lines.push(
    client.website
      ? `Sajt: ${client.website} (imaju sajt)`
      : `Sajt: nepoznato (ne pretpostavljaj da nemaju)`,
  );
  if (client.notes) lines.push(`Beleške: ${client.notes}`);
  return `Napiši sadržaj za prvi kontakt za ovog klijenta:\n\n${lines.join("\n")}`;
}

// Defense if the model inserts a dash despite the instruction anyway — never
// rely on the prompt alone for a hard style rule.
export function stripDashes(text: unknown): string {
  return typeof text === "string" ? text.replace(/[—–]/g, ",") : String(text ?? "");
}

// The model writes exactly "[Kostić link]" as a placeholder (instructed in
// the prompt); the real URL is substituted here, deterministically, instead
// of trusting the model to reproduce a link byte-for-byte. A no-op for text
// that doesn't contain the placeholder (e.g. call-script bullets).
export function insertKosticLink(text: unknown): string {
  return typeof text === "string"
    ? text.replaceAll("[Kostić link]", KOSTIC_GRADNJA_URL)
    : String(text ?? "");
}

export function finalize(text: unknown): string {
  return stripDashes(insertKosticLink(text)).trim();
}
