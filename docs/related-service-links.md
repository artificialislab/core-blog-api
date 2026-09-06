# Optional related service navigation

A website can preserve relevant service links in each article's initial HTML after every SEO refresh. The feature is opt-in and does not modify clinical article content or infer a treatment indication. Sites without configuration retain their existing output.

```json
{
  "staticRoutes": [{ "loc": "/extracao-de-siso-itajai" }],
  "blog": {
    "serviceLinks": [
      {
        "label": "Extração de siso em Itajaí",
        "path": "/extracao-de-siso-itajai",
        "keywords": ["siso", "sisos"]
      }
    ]
  }
}
```

`normalizeServiceLinks` accepts at most 30 entries, 20 keywords per entry, labels up to 100 characters, keywords up to 80 characters and paths up to 240 characters. Invalid entries are ignored. The path must be a lowercase ASCII local route, with no query, fragment, encoded segments, traversal or empty segment, and must exist exactly in `staticRoutes` (`{ loc }` or string form). The website build/deploy remains responsible for verifying that the configured static page actually exists. Duplicate paths retain the first valid entry.

`selectServiceLinks(config, post)` uses only title, slug and category; never body, excerpt or tags. Matching removes accents, lowercases text and treats punctuation/hyphens as word separators. Keywords match complete words or phrases within a single metadata field. Singular and plural are distinct: configure both where appropriate. Config order sets priority; at most three matches are returned.

A matching article receives an escaped heading “Atendimento relacionado” and plain links after its body. There is no contact event, tracking, third-party request or added scheduling CTA. A broad category keyword may match many articles, so order specific procedures before broad services and avoid overly generic keywords. The website frontend must consume the same rules to preserve parity after React mounts.

Validation: behavioral tests cover configuration rejection, accents/phrases, body exclusion, deduplication, maximum output, escaping and regeneration after article updates. All 45 tests pass on Node 22. The generated section was visually checked at 1280×900 and 390×844 in a Chromium preview, with legible underlined links and no overflow. The preview uses synthetic content. No production deployment is performed by this change.
