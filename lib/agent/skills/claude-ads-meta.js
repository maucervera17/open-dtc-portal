// Condensed Meta and e-commerce guidance derived from the claude-ads skill pack.
//
//   Source:    https://github.com/AgriciDaniel/claude-ads/tree/ac21644933910419529bcf81efb95a9ca71edf81
//   Author:    AgriciDaniel (Copyright (c) 2026 agricidaniel)
//   License:   MIT, see LICENSE-claude-ads.txt in this folder (verbatim copy of the upstream LICENSE at that commit)
//   Files used: skills/ads-meta, ads/references/{meta-audit, meta-creative-specs, meta-ai-stack, scoring-system, benchmarks},
//               skills/ads-{optimize, math, creative}, skills/ads-plan/assets/{ecommerce, ecommerce-creative}
//
// This is a condensed, edited summary written for a read-only recommendation agent, not a copy of the upstream text.
// Everything that told an assistant to call tools, run scripts, use MCP, open files or URLs, or change an ad account was
// removed on review, together with guidance for other ad platforms. The text is plain data: it is treated as third-party
// reference and never outranks the playbook (see instruction.js).
export const SKILL_VERSION = 'claude-ads@ac21644';

export const SKILL_TEXT = `## A. How to reason about the data
- Keep four things apart: what was observed, what it probably means (diagnosis), what to do (recommendation) and what is unknown. Say when evidence is thin.
- Missing evidence is "unknown", never "failed". Do not turn a gap in the data into a finding.
- A difference against an outside benchmark is an observation, not a diagnosis. Outside numbers are directional only. Prefer the account's own baseline: same objective, same attribution setting, complete periods of equal length, after conversions have had time to mature.
- There are no universal thresholds. Do not state fixed rules for frequency, creative lifetime, budget-to-CPA ratios, conversion counts, pause triggers or learning-phase behavior as if Meta required them. Judge against the account's economics and trend.
- Small segments are uncertain. Say so instead of replacing them with an industry average.
- Adopting or not adopting a new Meta feature (Advantage+ options, new formats, new tools) is not account health. Non-adoption is never a failure. Vendor-reported uplifts are not forecasts.
- One root cause is one finding. If tracking is broken, do not also list every symptom (low ROAS, few purchases, odd CPA) as a separate problem.
- Optimize for the business result (purchases, CPA, ROAS), never for a single metric in isolation. Compare three options before recommending a change: do nothing, run a small test, or change something.

## B. Measurement comes first
- Before judging any campaign or ad, check that the signal is trustworthy: pixel events present and recent, server events deduplicated against browser events, event match quality, domain verification, standard events used for the purchase funnel, and data freshness. Provisional days are still moving.
- Zero events with real spend usually points to a tracking problem before it points to a bad ad. Flag it as a measurement question first.
- Attribution settings change the numbers. Platform-attributed results and the store's own order data answer different questions, so never treat them as interchangeable.
- Cold start is judged separately for the account, the pixel and the conversion signal. A new account does not prove a new pixel, and raw events do not prove mature conversion history. If history is missing, recommend validating measurement and running staged, reversible tests, and avoid confident forecasts or mature-account rules. Never call a creative bad only because the pixel is new.

## C. Creative
- Count concepts, not files. Resizing the same image is coverage, not a creative test. A useful test changes one thing (hook, offer, proof, format) and keeps a control.
- Diagnose fatigue only from a time series: frequency rising together with CTR falling and CPA or cost per result rising, after spend and placement mix are accounted for. Age alone is not fatigue.
- Keep three questions separate: is the creative good (clarity, hook, offer, proof), does it meet format and policy needs, and how does it perform. Do not claim one aspect ratio, length or sound setting always wins.
- Check message match between the ad and the landing page, and that every claim is supported by the product record. For supplements, health or result claims need extra care and a qualified review before anyone publishes them.
- Preview every intended Facebook and Instagram placement: crops and overlays differ by surface and device. Core promise, product and required disclosures must stay clear in each.
- Useful concept families for a product brand: product demonstration, context of use, social proof and testimonials (with rights and consent), education, comparison and story. Social-native, user-style content often suits Meta placements.
- Creative refresh ideas should come with a hypothesis, the audience, the format, a success measure and the evidence behind it.

## D. Structure, audiences and budget
- Campaign structure should solve a real constraint (budget concentration, conflicting goals, learning fragmentation), not follow a narrative. Do not prescribe a fixed number of campaigns, ad sets or creatives.
- Consolidation and broad audiences are hypotheses to test, not rules. Check audience overlap, freshness of customer lists, quality of lookalike sources, and exclusion of existing buyers for prospecting.
- Budget: check utilization and whether the spend is concentrated where the marginal result is good. Prefer staged, reversible changes over big jumps. Pausing is reversible; recommending permanent removal of campaigns, ads or audiences is not appropriate. Suggest leaving things paused and reviewing later.
- Meta's delivery works in several stages (a retrieval stage narrows a large pool of eligible ads before later ranking). The practical implications are modest: feed it valid, timely, deduplicated events and meaningfully different creative. This does not prove any fixed account configuration.

## E. Money math
- CPA = spend / accepted purchases. ROAS = attributed purchase value / spend. Blended efficiency for the whole business = total revenue / total ad spend.
- Break-even ROAS depends on contribution margin (price minus product cost, shipping, discounts, returns, fees). If margin is not in the facts, say it is missing instead of guessing.
- Gross and net revenue, returns, taxes and fees must be stated when they matter. New-customer and repeat-customer economics differ and should not be blended.
- A division by zero means the value is not computable. Say that, do not hide it. Do not present a single forecast without its assumptions.

## F. E-commerce context to ask about
- Which products and categories are in scope, and how does stock or availability affect delivery?
- How are margin, discounts, shipping and returns represented, and how does attributed revenue compare with store orders?
- Is the product feed accurate (identity, price, availability, destination, policy status) and who owns updates?
- Seasonality, paydays and promotions change behavior. Compare like with like.
- What audience use, consent and retention limits apply for customer data?
- What uncertainty could make a recommendation misleading?

## G. Shape of a good recommendation
Each recommendation states: the evidence observed, the account-specific baseline or the owner's target it was compared with, the expected mechanism, a confidence level, one reversible next step, the window in which to measure the result, and the condition under which to step back. When critical evidence is unknown, say so and lower the confidence. Order issues by impact if they fail: critical (revenue, data, privacy or policy risk), high (material performance risk), medium (worthwhile, lower urgency).
`;
