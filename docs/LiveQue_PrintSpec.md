# LiveQue print spec

Everything needed to hand a business card file to a commercial printer and have
it come back right the first time. Researched July 2026. Sources cited where a
number is load-bearing.

Read the **Decisions** section first. The rest is reference.

---

## Decisions

### Use dyed-through black stock. Do not print a black card.

**Terminology matters here and I got it wrong at first.** "Coloured core" and
"dyed through" are opposite things:

- **Dyed through / pulp-coloured**: the pulp itself is black. Cut it anywhere
  and it is black. This is what you want.
- **Coloured core / triplex**: white outer plies bonded around a coloured
  middle ply. The edge reads as **white / black / white stripes**. This is a
  decorative effect, not a fix. Do not order it expecting a black edge.

Verified dyed-through blacks:

| Stock | Confirmed by | Note |
|---|---|---|
| **Sirio Ultra Black** (Fedrigoni) | The mill itself: "pulp-coloured", "black pulp-coloured without Carbon Black" | Strongest verification. 115 to 680 gsm. |
| **Colorplan Ebony** (GF Smith) | Jukebox only | GF Smith and Legion Paper (US distributor) do **not** state the dyeing method. Probably true, single-sourced. Confirm with the mill before a big run. |

Ink is translucent. Foil is opaque. That one sentence is why every printer
who works in this space says the same thing: on black stock you decorate with
**foil, white screen-print ink, or a blind deboss**, never with CMYK. Jukebox
states it flatly: *"We do not print ink on our Premium Black stocks as it will
not show."*

What that buys you:

| Failure mode on a printed black card | Dyed-through stock |
|---|---|
| White core shows at the cut edge | Black through, and it **wears gracefully**: abrade it and you expose more black |
| K100 solid reads charcoal | No ink to read weakly |
| Total ink coverage blows the limit | No coverage |
| Back-trap mottle in the chromatic underlayers | No underlayers |
| Ink set-off / blocking in the stack | Nothing wet |
| 24 to 72 hours dry time before converting | None |
| Scuffs card-on-card in the box | Nothing on the surface to scuff |
| Needs laminate, so burnishing and fingerprints | No laminate needed |

**And it is not the expensive option.** Colorplan Ebony at Jukebox runs about
$0.40 per card at 250. Edge-painting a white card costs $0.18 to $0.75 per
card on top of the base price, and black metal is $3.03 per card at 500.
The best-looking answer here is also among the cheapest.

### If printing CMYK on white stock instead

- Black must be a **rich black** build, not K100. K100 alone on a large panel
  reads charcoal.
- There is **no universal recipe.** Verified in use: 60/40/40/100 (Primoprint,
  Kinker, QPMN), 40/30/30/100 (Delzer), 40/30/20/100 (Printfever). Color Vision
  states outright that one printer may want 60/40/40/100 where another wants
  20/20/20/100. **Ask your printer and use their number.**
- Never use "registration black" (Prepressure).
- Never put rich black under small text. Misregistration shows as colour fringing.

---

## Geometry

| | Inches | mm | px @300 DPI | px @600 DPI |
|---|---|---|---|---|
| Trim (US standard) | 3.5 x 2.0 | 88.9 x 50.8 | 1050 x 600 | 2100 x 1200 |
| With bleed (+0.125" per edge) | 3.75 x 2.25 | 95.25 x 57.15 | 1125 x 675 | 2250 x 1350 |
| Safe area (0.125" inset from trim) | 3.25 x 1.75 | 82.55 x 44.45 | 975 x 525 | 1950 x 1050 |

MOO uses a slightly tighter bleed: 3.66 x 2.16" document, 3.5 x 2.0" trim,
3.34 x 1.84" safe. Use the printer's own template when one exists.

Rounded corners eat into the safe area at each corner. Keep anything critical
further in than the radius.

---

## Resolution and file format

- **300 DPI minimum** for raster. 600 DPI for fine line art and small type.
- **Vector is better than raster** for type, logo and QR. PDF, AI or EPS.
- **Outline or embed all fonts.**
- **CMYK**, not RGB. US printers generally expect US Web Coated (SWOP) or
  GRACoL 2013. Confirm with the printer.
- **No crop marks** unless the printer asks. Most add their own.
- Front and back usually as **two separate files or a 2-page PDF**. Name them
  unambiguously, e.g. `glen-front.pdf` / `glen-back.pdf`.

---

## Colour: what survives CMYK and what does not

The LiveQue screen palette will shift. Honest expectations:

| Screen | Behaviour in CMYK |
|---|---|
| `#4ecdc4` teal | Noticeably duller. Bright cyan-greens sit near the gamut edge. Consider a Pantone if it matters. |
| `#ffd700` gold | Prints as flat yellow. Metallic gold needs **foil**, not ink. There is no CMYK gold. |
| `#ff6b6b` coral | Reasonably close. Slightly muddier. |
| `#080808` near-black | See the rich black note above. |

If gold matters, that is a foil decision, not a colour decision.

---

## QR code

- **Vector, not raster.** Never scale up a raster QR.
- **Minimum 0.8 inch / 20mm square** on a card. Smaller works in lab
  conditions and fails in a dark bar.
- **Quiet zone** of at least 4 modules of clear space on all sides. Do not
  crowd it with artwork.
- **Contrast:** dark code on light ground scans most reliably. An inverted
  (light-on-dark) code works on many but not all scanners. On a black card,
  put the QR in a white or light panel rather than inverting it.
- Always print the **human-readable URL** next to it. Some people will not
  scan, and the FBI has publicly warned consumers against scanning unknown QR
  codes.

---

## Spot UV, if used

- **Registration drifts up to 1/16 inch (1.6mm)** and that is *within spec*,
  not a defect (SinaLite, published). On a 50mm-tall card that is enormous.
  Design spot UV as **standalone shapes** that do not need to align to anything
  printed. No gloss keylines, no gloss text inside a printed shape.
- **5mm clear of every edge**, or it peels at the guillotine. SinaLite silently
  auto-insets full-bleed spot files, changing your artwork without a proof.
- **Coverage cap:** MOO under 50%, Flexpress recommends under 25%.
- **Minimum 8pt type, 0.3mm line weight** (QinPrinting).
- Supply the mask as **vector, 100% K, white elsewhere.** No greys, no
  gradients, no halftones.
- Requires matte or soft-touch laminate underneath. Gloss-on-gloss has no
  contrast.

---

## Finishes: the honest table

| Finish | Reality on a dark card |
|---|---|
| Soft touch | Velvet feel, reads deep. **Pen ink separates on it** (Smartpress). Burnishes shiny at corners in a wallet. Fingerprints disputed: the vendors selling it say no problem, independent reviewers say marks show on big dark solids. |
| Matte | Shows abrasion and burnishing worst of all against black. Ask for **anti-scratch matte** if going this route. |
| Silk | Hides handling better than dead matte. Good middle ground. |
| Gloss | Best scratch resistance, worst fingerprints, and kills any spot UV contrast. |
| Foil | The only real metallic. Prints on top and obscures what is underneath. |
| Letterpress | **Wrong twice over.** Large solids mottle (the trade term is "salting") and every printer publishes a coverage ceiling of 20 to 50%, where a black card is 60 to 100%. And white ink on dark paper fails separately: "the dark colour stock will show through the white ink." Crane Lettra, the canonical letterpress stock, is not made in black at all. That absence is the industry's answer. |
| Edge painting | Solves the white-core edge on a printed card. Adds real cost. |

---

## Ordering realities

- **MOO does not sell 250 or 500.** Tiers are 50 / 100 / 200 / 400 / 600 /
  800 / 1000. Any 250-count MOO quote is wrong.
- **MOO Printfinity varies the back only.** The front is always identical. Two
  people can share one order only if they share a front.
- **Jukebox is one design per order**, stated in their own docs. Two people
  means two orders.
- MOO special finishes (foil, spot gloss, letterpress) are **excluded from
  next-day**.

---

## Vendor risk, specifically for black

Ranked worst to best for a black-heavy job, from published specs plus verified
customer reports.

| Vendor | Assessment |
|---|---|
| **Printed.com** | **Highest risk.** Publishes the lightest rich black of anyone (160%), and has multiple independent "black background printed lighter than expected" reports. In one case they conceded the fault was "limitations and inconsistencies in the online colour selection options," not the customer. |
| **GotPrint** | One customer had a single order **split across offset and digital presses without being told**, producing three visibly different cards, one with "black text pale gray." Also a mottled-black report from a 15-year customer using a file that printed fine elsewhere. |
| **Vistaprint** | The only one publishing a real rich black recipe (C60 M40 Y40 K100). But repeated "printed darker than the proof, dark detail plugged" reports, and their own agent explained that matte stock absorbs more ink. |
| **MOO** | Their own docs steer Luxe and Cotton away from this job: "muted", "works best with minimal ink coverage." Super Soft Touch is the one they recommend for bold work. No published rich black or ink limit. The widely-quoted "MOO uses 30/30/30/100" is from a third-party blog, not MOO. |
| **Jukebox** | Best reputation for black, **but for a reason that does not transfer**: their Premium Black is black *paper* decorated with *foil*, with no CMYK option at all. That reputation says nothing about their black-ink printing, and their most recent black-ink review is a repeat customer reporting "our black changed to a charcoal." |

The pattern across every vendor: the most common failure is not washed-out
black, it is **the final print coming out darker than the approved proof**,
with dark-on-dark detail disappearing entirely.

## What each finish actually costs

Measured at one printer (PrintPlace) at 500, varying one thing at a time, so
these are real multipliers rather than cross-vendor guesses. Baseline is a
500-run 14pt gloss card at $33.65.

| Finish | Price at 500 | vs baseline |
|---|---|---|
| Gloss or matte, 14pt | $33.65 | 1.00x |
| Uncoated, 14pt | $34.35 | 1.02x |
| High gloss UV | $42.10 | 1.25x |
| Silk laminate, 16pt | $50.50 | 1.50x |
| + spot UV | $58.50 | **+$8 isolated** |
| + rounded corners | $82.50 | **+$24 isolated** |
| Soft touch, 16pt | $85.00 | 2.53x |
| Foil, hot stamped | $129.50 | 3.85x |
| Painted edge, 32pt | $129.50 | 3.85x |
| Raised spot UV | $141.50 | 4.20x |
| Letterpress | ~$280 to $480 | ~6 to 10x |
| Triplex / coloured core | ~$310 | ~9x |

**Two corrections to common assumptions:**

- **Uncoated is not cheaper than gloss.** It costs marginally more.
- **The "$80 die charge" for foil is largely a myth.** Only one vendor itemises
  it, and there it is a *reorder credit*, not an upfront fee. Wes-Tex states
  "all makeready and die charges are included." Budget zero for a die at a
  volume online printer.

**Foil pricing varies wildly and any single number is unreliable.** At 500
across legitimate US printers it runs **$82 to $539**, a 6.5x spread, driven by
whether CMYK printing is bundled and what stock and lamination come with it.
Get two quotes. Notably, the cheapest of them (Wes-Tex, $82) prints its foil
cards on **black stock**, which is the configuration recommended here.

**Why foil works on black, technically:** hot foil is not ink. It is a
multilayer film with a **vacuum-metallised aluminium layer**, transferred by
heat and pressure. That metal sits on top of the sheet and is fully opaque, so
the paper colour underneath is irrelevant. CMYK is translucent and depends on
white paper bouncing light back through it, which is why cyan and yellow
essentially vanish on black stock.

---

## Vendors with real published prices

Most specialty shops are quote-only. These publish actual numbers.

**Czar Press** is the one that can execute the recommended card today at a
known price. They stock Colorplan and Gmund, their standard foils **include
white**, and their digital-white-ink line is priced specifically for coloured
stock. 3.5 x 2", single sided:

| | 100 | 250 | 500 |
|---|---|---|---|
| White foil, 1 colour | $305 | $425 | $625 |
| Digital white ink on coloured stock | $130 | $250 | $450 |
| Blind emboss | $425 | $575 | $825 |
| Edge painting | $135 first 500, then $55 per 250 | | |

Turnaround 12 to 15 business days. No digital proofs; they print from your
files, with a $10 photo proof on request. Minimum 0.3pt line weight for foil,
1.5pt for emboss. **Caveat: this is their published wholesale sheet.** Retail
pricing is not published anywhere, so treat it as a benchmark, not a quote.

**Hoban Cards** has the best two-design economics found anywhere: an explicit
**10% off for ordering two designs**, plus plates kept on file for cheaper
reorders. But it is template-based, black ink only, and caps at 250.

**Boxcar Press** is the most capable for something genuinely unusual, notably
900gsm Keaykolour Deep Black 3-ply. Quote-only with a **$500 minimum**.

**Dead or irrelevant, do not waste time:** Dot Rhino (domain parked), Studio On
Fire (closed, absorbed into Franklin Press), Rohner (domain gone), Mandate
Press (parked), Smock and Bella Figura (wedding stationery only, no business
card line).

---

## NFC: probably not, and here is the honest reason

**NFC cannot do what your QR code does.** A QR on a table tent is scanned from
three feet away by six people at once with nobody present. NFC is strictly one
person at a time, physical contact, phone unlocked, screen on, camera closed.
At a gig, that is a downgrade.

It only makes sense for handing a card to one booker standing in front of you.
Price it against that, not against the audience use case.

The vendor market is also churning badly:

- **Linq has left the business.** linqapp.com now sells messaging APIs. Cards
  still work but the platform is labelled "Legacy."
- **Popl deleted its consumer storefront.** The product URL redirects to their
  enterprise lead-capture page; their product feed returns empty.
- **Popl password-locks the chip.** A verified teardown recovered the password;
  ordinary NFC rewriting tools fail. The card is not straightforwardly yours.
- **OVOU** will not sell a card outside a subscription and says plainly they
  deactivate it if you cancel.
- **MOO discontinued NFC cards** entirely.

Apple's own docs kill the "it just works" pitch: background tag reading needs
**iPhone XS or later**, the notification banner **does not auto-open** (the
recipient has to notice it and tap), and reading is **disabled while the camera
is in use**, which at a live show is most of the time. V1CE's marketing claim
that cards "work on every phone made since 2015" is simply false.

**If you want NFC anyway, do it yourself and skip every platform.** Custom
full-bleed PVC with an NTAG chip, URL pre-encoded free, MOQ 1, runs about
**$2.20 a card** at 100. Popl equivalent is roughly $14.99 a card plus $80 to
$960 a year. Point the URL at a domain you own so you can repoint it forever,
put a printed QR on the same card as the fallback, and **do not lock the tag**.

Two material facts: **paper and cotton do not block NFC**, so a sticker on the
back of a letterpress card works. **Metallic foil does block it**, so keep foil
about 30mm clear of the chip.

---

## A security note from the research

`popl.co` serves an `agents.md` file containing instructions aimed at AI agents,
telling them to install a third-party shopping skill and transact through a
commerce protocol. Our researcher correctly treated it as page content rather
than as instructions and did not act on it.

Worth knowing that vendor sites now embed this. Anything an automated tool
reads from a vendor page is data, not a command, no matter how it is phrased.

---

## Before committing to a full run

1. **Order a sample pack.** Jukebox charges $1. Cheap insurance.
2. **Ask for solid-black samples specifically**, and rub them. Put one in a
   pocket for a week.
3. **Press-test on the actual stock and finish** if the run is large. Digital
   versus offset for large solid darks is genuinely unsettled between sources;
   each has different failure modes and nobody has data settling it.
4. If printing CMYK, ask the printer for **their** rich black build and
   **their** total ink limit. Practical business-card range is 240 to 300%.

---

## Things widely gotten wrong

1. Set-off, blocking and gloss ghosting are three different defects with
   different causes. They get used interchangeably and shouldn't be.
2. Dark ink's stacking risk is partly **thermal**. Dark pigment absorbs and
   retains pile heat, which is why Sappi prescribes short lifts specifically
   for dark work.
3. Back-trap mottle is a **coated-paper, non-black-ink** defect. Black runs a
   thicker, slower-setting film and does not back-trap; cyan does. A blotchy
   rich black is most likely the cyan underlayer.
4. **"Passes the Sutherland rub test" means nothing** on its own. Neither ASTM
   D5264 nor TAPPI T830 defines a numeric pass mark. Weight, stroke count,
   receptor material and acceptance criteria must all be stated.
5. Spray powder does not exist on digital presses. Powder-related problems are
   an offset-only concern, but digital also loses that sheet-separation
   safety net.
6. Higher-gloss aqueous coatings are **softer** and block more easily, not less.

---

## Known gaps

- **Reddit blocks our crawler entirely.** r/printing and r/graphic_design were
  the best available source for unfiltered customer complaints about black
  cards printing grey, and none of that is represented here. Everything above
  is printer documentation and independent guides. Worth a manual look.
- No rigorous source found on toner gloss differential in solid areas
  specifically. The "plasticky patch" effect is widely reported by
  practitioners but was not verified against a real study.
- Exact drying time before lamination: no fetchable source gives a hard number.
  The 24-hour figure is trade folklore. Sappi gives 24 to 72 hours for full
  oxidation before converting, which is the closest thing to an answer.
