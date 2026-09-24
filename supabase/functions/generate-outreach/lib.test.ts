import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildUserPrompt, finalize, insertKosticLink, resolveChannel, stripDashes } from "./lib.ts";

Deno.test("resolveChannel maps known channels and falls back to viber", () => {
  assertEquals(resolveChannel("email"), "email");
  assertEquals(resolveChannel("telefon_fiksni"), "telefon");
  assertEquals(resolveChannel("instagram"), "instagram");
  assertEquals(resolveChannel("viber"), "viber");
  assertEquals(resolveChannel(undefined), "viber");
  assertEquals(resolveChannel("something-unexpected"), "viber");
});

Deno.test("stripDashes replaces em and en dashes with commas", () => {
  assertEquals(stripDashes("brzo — jednostavno – gotovo"), "brzo , jednostavno , gotovo");
  assertEquals(stripDashes("no dashes here"), "no dashes here");
});

Deno.test("stripDashes falls back to an empty string for null/undefined input", () => {
  assertEquals(stripDashes(undefined), "");
  assertEquals(stripDashes(null), "");
});

Deno.test("insertKosticLink substitutes the placeholder deterministically", () => {
  const result = insertKosticLink("Evo primera: [Kostić link] pogledajte.");
  assertEquals(result, "Evo primera: https://kosticgradnja.hr/ pogledajte.");
});

Deno.test("insertKosticLink is a no-op when the placeholder is absent", () => {
  assertEquals(insertKosticLink("nema linka ovde"), "nema linka ovde");
});

Deno.test("finalize composes link substitution, dash stripping and trimming", () => {
  const result = finalize("  Pogledajte [Kostić link] — besplatno.  ");
  assertEquals(result, "Pogledajte https://kosticgradnja.hr/ , besplatno.");
});

Deno.test("buildUserPrompt includes only the fields that are present", () => {
  const prompt = buildUserPrompt({
    name: "Ana",
    company: "",
    category: "",
    source: "",
    website: "",
    notes: "",
  });
  assertEquals(prompt.includes("Kontakt osoba: Ana"), true);
  assertEquals(prompt.includes("Firma:"), false);
  assertEquals(prompt.includes("Sajt: nepoznato (ne pretpostavljaj da nemaju)"), true);
});

Deno.test("buildUserPrompt reflects a known website instead of the unknown fallback", () => {
  const prompt = buildUserPrompt({
    name: "",
    company: "Zanat doo",
    category: "",
    source: "",
    website: "https://example.com",
    notes: "",
  });
  assertEquals(prompt.includes("Sajt: https://example.com (imaju sajt)"), true);
});
