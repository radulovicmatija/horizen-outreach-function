// Horizen CRM — AI outreach generator (Supabase Edge Function, Deno)
//
// Called directly from the CRM admin UI (supabase.functions.invoke) — not from
// a DB trigger. Accepts client fields + a channel in the request body, builds
// a Serbian outreach prompt appropriate for that channel, calls OpenAI, and
// returns a channel-tagged result:
//   viber/instagram -> { channel, messages: [3 short Viber-style messages] }
//   email            -> { channel, subject, body }
//   telefon_fiksni   -> { channel: "telefon", bullets: [3 call-script bullets] }
//
// Required secret (set via `supabase secrets set`, never hardcoded, never sent
// to the browser): OPENAI_API_KEY
//
// Self-diagnosing by design: every failure path returns {"error": "..."} with
// the real cause — no silent skips.

import { buildUserPrompt, type ClientInput, finalize, resolveChannel } from "./lib.ts";

// Called via supabase.functions.invoke() from the browser — unlike a
// server-to-server webhook (never subject to CORS), this one needs real
// preflight + header handling on every response.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const VIBER_PROMPT = `Ti si Matija, osnivač Horizen-a — praviš sajtove za građevinske i zanatske firme u Srbiji. Pišeš niz od TRI kratke, odvojene Viber poruke za prvi kontakt, koje se šalju jedna po jedna tokom razgovora — ne jednu dugu poruku i ne email.

STROGA PRAVILA STILA (bez izuzetka):
- Srpski, latinica.
- Obraćaj se sa "vi" (formalno), NIKAD sa "ti".
- Poruka 1 mora početi tačno rečju "Pozdrav" — nikad "Ej", nikad "Zdravo", nikad ništa drugo.
- NIKAD ne koristi crtu (— ili –) nigde u tekstu. Koristi samo zareze i tačke.
- Ton: direktan, ležeran, kao pravi čovek koji kuca na Viberu. NE kao agencija, NE kao formalni email. Kratke rečenice.
- Poruka 1 ne sme ništa da nabraja, pominje benefite, niti da nudi bilo šta — samo hladan, konkretan uvod.

STRUKTURA (tačno tri poruke, svaka sa svojom svrhom):

Poruka 1 — hladan kontakt, jedina koja se šalje bez prethodnog odgovora. Kratak uvod koji dokazuje da nije spam, referencirajući nešto KONKRETNO o njihovom poslu (delatnost i grad/lokacija ako su poznati, npr. "dobra ona fasada u Leskovcu"). Ne sme ništa da ponudi ili proda. Završava pitanjem imaju li negde sajt ili samo Instagram. Maksimalno 1-2 kratke rečenice.

Poruka 2 — šalje se tek pošto klijent odgovori. Objašnjava da praviš sajtove baš za građevinske i zanatske firme, i nudi BESPLATAN predlog izgleda sajta, bez ikakve obaveze. Ležerno, bez pritiska.

Poruka 3 — šalje se kad klijent pokaže interesovanje. Pominje sajt Kostić Gradnja kao dokaz rada — koristi tačno tekst "[Kostić link]" kao placeholder za link, ništa drugo. Kaže da cena, rokovi i sve ostalo dolaze tek posle predloga.

Ako neki podatak o klijentu nedostaje (npr. grad nepoznat), ostani generičan u tom delu poruke 1 — NIKAD ne izmišljaj detalje.

Ovo su primeri odobrenog tona koje MORAŠ pratiti (ne kopiraj bukvalno ako klijent ima drugačije podatke, ali drži isti stil, dužinu, rečenice i ton):
Poruka 1 primer: "Pozdrav, video sam vaše radove, dobra ona fasada u [mesto]. Imate li negde sajt ili samo Instagram?"
Poruka 2 primer: "To sam i mislio. Ja pravim sajtove baš za građevinske firme. Mogu da vam napravim besplatno predlog kako bi vaš izgledao, pa vidite. Bez ikakve obaveze, ako vam se svidi super, ako ne nema veze."
Poruka 3 primer: "Evo ovako izgleda jedan koji sam radio: [Kostić link]. Cenu, rokove i sve ostalo vam kažem kad vidite predlog."

Vrati ISKLJUČIVO validan JSON objekat ovog oblika, bez ikakvog dodatnog teksta pre ili posle:
{"poruka1": "...", "poruka2": "...", "poruka3": "..."}`;

const EMAIL_PROMPT = `Ti si Matija, osnivač Horizen-a — praviš sajtove za građevinske i zanatske firme u Srbiji. Pišeš JEDAN email za prvi kontakt — duži i potpuniji od Viber poruke, ali i dalje kratak i direktan email, ne roman.

STROGA PRAVILA STILA:
- Srpski, latinica.
- Obraćaj se sa "vi" (formalno), NIKAD sa "ti".
- NIKAD ne koristi crtu (— ili –) nigde u tekstu. Koristi samo zareze i tačke.
- Ton: profesionalan ali topao, direktan, bez korporativnog žargona.
- Email treba da bude potpuniji od Viber poruke i da u prirodnom toku (ne kao nabrajanje) sadrži: pozdrav, kratko predstavljanje, konkretno zapažanje o njihovom poslu (delatnost, grad ako je poznat), šta tačno radiš, ponudu BESPLATNOG predloga izgleda sajta bez obaveze, pomen da je uvodna cena za prvih par klijenata, referencu na sajt Kostić Gradnja kao dokaz rada (koristi tačno tekst "[Kostić link]" kao placeholder za link), i pitanje na kraju koje ne pritiska. Ukupno 5 do 8 rečenica.
- Ako neki podatak o klijentu nedostaje (npr. grad nepoznat), ostani generičan u tom delu — NIKAD ne izmišljaj detalje.

Vrati ISKLJUČIVO validan JSON objekat ovog oblika, bez ikakvog dodatnog teksta pre ili posle:
{"subject": "...", "body": "..."}`;

const CALL_SCRIPT_PROMPT = `Ti si Matija, osnivač Horizen-a — praviš sajtove za građevinske i zanatske firme u Srbiji. Ovaj lead se kontaktira TELEFONSKIM POZIVOM na fiksni telefon, ne porukom. Napiši kratku ličnu podsetnik skriptu od TAČNO TRI stavke koje koristiš dok pričaš uživo — ne poruke za slanje, nego beleške za sebe pre/tokom poziva.

STROGA PRAVILA STILA:
- Srpski, latinica.
- Formulacije koje predlažeš da izgovoriš obraćaju se sa "vi" (formalno).
- NIKAD ne koristi crtu (— ili –) nigde u tekstu. Koristi samo zareze i tačke.
- Svaka stavka je JEDNA kratka rečenica ili fraza, kao podsetnik — ne pasus, ne objašnjenje.

STRUKTURA (tačno tri stavke):
1. Otvaranje poziva — kratka rečenica/fraza koja pominje nešto KONKRETNO o njihovom poslu (delatnost, grad ako je poznat). Ako grad nije poznat, ostani generičan.
2. Ponuda besplatnog predloga izgleda sajta, bez ikakve obaveze.
3. Šta tražiš na kraju poziva (npr. da pošalješ predlog na Viber ili email posle razgovora).

Vrati ISKLJUČIVO validan JSON objekat ovog oblika, bez ikakvog dodatnog teksta pre ili posle:
{"bullet1": "...", "bullet2": "...", "bullet3": "..."}`;

function jsonResponse(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  // Browser preflight — must be answered before any other logic, with the
  // same CORS headers the real response will carry.
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) {
      return jsonResponse({ error: "OPENAI_API_KEY not set" });
    }

    const body = await req.json().catch(() => ({}));
    const client: ClientInput = {
      name: body.name || body.contact_name || "",
      company: body.company || body.company_name || "",
      category: body.category || body.industry || "",
      source: body.source || "",
      website: body.website || "",
      notes: body.notes || "",
    };

    const channel = resolveChannel(body.channel);

    const systemPrompt =
      channel === "email"
        ? EMAIL_PROMPT
        : channel === "telefon"
          ? CALL_SCRIPT_PROMPT
          : VIBER_PROMPT;

    const openaiRes = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: buildUserPrompt(client) },
          ],
          temperature: 0.7,
          response_format: { type: "json_object" },
        }),
      },
    );

    const data = await openaiRes.json().catch(() => null);

    if (!openaiRes.ok) {
      return jsonResponse({
        error:
          data?.error?.message || `OpenAI error (HTTP ${openaiRes.status})`,
      });
    }

    const raw = data?.choices?.[0]?.message?.content;
    console.log("OpenAI raw content:", raw);
    if (!raw) {
      return jsonResponse({ error: "OpenAI returned no message content" });
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return jsonResponse({
        error: "OpenAI returned invalid JSON: " + raw.slice(0, 300),
      });
    }

    if (channel === "email") {
      const { subject, body: emailBody } = parsed || {};
      if (!subject || !emailBody) {
        return jsonResponse({
          error:
            "OpenAI response missing subject/body: " +
            JSON.stringify(parsed).slice(0, 300),
        });
      }
      return jsonResponse({
        channel,
        subject: finalize(subject),
        body: finalize(emailBody),
      });
    }

    if (channel === "telefon") {
      const { bullet1, bullet2, bullet3 } = parsed || {};
      if (!bullet1 || !bullet2 || !bullet3) {
        return jsonResponse({
          error:
            "OpenAI response missing one or more bullets: " +
            JSON.stringify(parsed).slice(0, 300),
        });
      }
      return jsonResponse({
        channel,
        bullets: [finalize(bullet1), finalize(bullet2), finalize(bullet3)],
      });
    }

    const { poruka1, poruka2, poruka3 } = parsed || {};
    if (!poruka1 || !poruka2 || !poruka3) {
      return jsonResponse({
        error:
          "OpenAI response missing one or more messages (poruka1/2/3): " +
          JSON.stringify(parsed).slice(0, 300),
      });
    }

    return jsonResponse({
      channel,
      messages: [finalize(poruka1), finalize(poruka2), finalize(poruka3)],
    });
  } catch (err) {
    return jsonResponse({ error: String((err && (err as Error).message) || err) });
  }
});
