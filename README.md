# AI outreach generator

A Supabase Edge Function that drafts first-contact outreach messages for a CRM, in Serbian, shaped to whichever channel a lead prefers — Viber, Instagram, email, or a call script for landlines. It's the one AI feature in an otherwise plain CRM I built for my studio.

The OpenAI call itself is the easy part. What's worth showing is that the function doesn't trust what comes back — the model is told never to use em-dashes and to reference a link with a placeholder, and both rules get enforced in code anyway:

```ts
function stripDashes(text) {
  return typeof text === "string" ? text.replace(/[—–]/g, ",") : text;
}
function insertLink(text) {
  return typeof text === "string" ? text.replaceAll("[link]", PORTFOLIO_URL) : text;
}
```

A prompt instruction is a preference, not a guarantee. If the model ignores it, the output is still correct — a hallucinated or mistyped link can never reach a lead, because the real URL was never something the model got to write.

The pure logic — prompt building, channel selection, this sanitization — lives in `lib.ts`, separate from the `Deno.serve` handler, so it's testable without mocking a request or hitting OpenAI:

```bash
cd supabase/functions/generate-outreach
deno test   # 8 passing, no network
```

## What's not great

The tests cover the logic around the OpenAI call, not the call itself — nothing here would catch OpenAI changing their response shape. The model, temperature, and prompts are also hardcoded; trying a different model means editing source, not flipping a config value.

---

Matija Radulović · [horizen.rs](https://horizen.rs)
