# Localisation

The worker app, sign-in page and public report pages are available in **English, Tamil (தமிழ்) and Hindi (हिन्दी)**. The employer console is English only.

## Status of each language

| Language | Status |
| --- | --- |
| English | Source language. Written in plain words for readers with limited formal education: short sentences, no jargon ("Paid time", not "Payable hours"). |
| Tamil | Complete. **Drafted with AI assistance and not yet reviewed by a native speaker.** |
| Hindi | Complete. **Drafted with AI assistance and not yet reviewed by a native speaker.** |

The Tamil and Hindi files say this at the top. Before FairShift is used with real workers, both should be reviewed by native speakers who know the vocabulary used on construction sites and by facilities staff, and tried with workers in a moderated session.

## How it works

- Strings live in [src/web/i18n/en.ts](../src/web/i18n/en.ts), [ta.ts](../src/web/i18n/ta.ts) and [hi.ts](../src/web/i18n/hi.ts). The Tamil and Hindi files are typed against the English keys, so a missing or misspelled key fails the type check.
- Placeholders such as `{amount}` are filled at runtime. Money, dates, times and durations are formatted with the browser's `Intl` APIs for `en-IN`, `ta-IN` or `hi-IN`, so rupee grouping (₹1,20,000.00), month names and weekdays follow the language.
- The Fairness Replay builds each sentence from a translated template and the engine's numbers, so the explanation is translated, not just the labels.
- The chosen language is saved on the worker's account and in the browser, and sets `lang` on the page so screen readers use the right voice.
- Buttons in the language switch show the language's own script and carry its full name for assistive technology.

## Read-aloud

The pay explanation has a "Listen" button that uses the device's built-in speech voices (`speechSynthesis`). It only speaks if the device has a voice for the selected language. If it does not, the app says so instead of reading Tamil text with an English voice. Availability of Tamil and Hindi voices depends on the phone's operating system and installed languages.

## Testing

- The browser tests switch the worker app into each language and run the accessibility checks and the 360 px no-horizontal-scroll check on every worker screen.
- Journey C files an urgent report in Hindi and reads the pay explanation in Tamil.

## Adding a language

1. Copy `hi.ts` to a new file, translate every value, keep every key.
2. Add the language to `LANGS` in [src/web/i18n/i18n.tsx](../src/web/i18n/i18n.tsx) with its locale (for example `te-IN`).
3. Add the code to the `lang` enum in the preferences route and the `users.lang` column check.
4. Add it to the language loop in [tests/e2e/accessibility.spec.ts](../tests/e2e/accessibility.spec.ts).
