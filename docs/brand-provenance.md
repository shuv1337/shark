# SHark brand asset provenance

## Ownership and source

The operator confirmed the Devil Phone as supplied project artwork owned for use in SHark. The
authoritative recovery source is the operator-controlled public repository
`https://github.com/shuv1337/codex-quota` at commit
`1ab5f909ba0c6bb3f67176a3b51ec9f87e486105`; both assets were introduced by the `shuv1337`
authored commit `4f81f49ac9c3eb5904f3af395fda7b67e76336c3`.

That repository is MIT-licensed. Its `web/icons/THIRD_PARTY_NOTICES.md` explicitly says
`devil-phone.svg` and its PNG/ICO derivatives are supplied project artwork and are not covered by
the third-party notices. This positive repository evidence, the matching historical hashes, and the
operator's prior ownership confirmation form the reuse basis.

| Tracked source | Historical repository path | SHA-256 |
| --- | --- | --- |
| `assets/brand/devil-phone.svg` | `web/icons/devil-phone.svg` | `3489212420a5c2cbaa56cec28933b1e1284739b11e3388650ea3fb8a4a7e9f69` |
| `assets/brand/icon-maskable-512.png` | `web/icons/icon-maskable-512.png` | `5d3fa36bb3865110761752c978b811d0b44755e44a99376acf6c9f453af9af1e` |

## Deterministic generation

Run:

```sh
pnpm brand:generate
pnpm brand:check
```

`scripts/generate-brand-assets.mjs` verifies both source hashes before rendering. It uses the exact
reviewed `@resvg/resvg-js@2.6.2` dependency, disables system-font loading, and uses only vector paths
plus an embedded deterministic pixel alphabet. Opaque outputs are encoded as 8-bit RGB PNG with
Node.js zlib level 9, filter-none rows, and no ancillary metadata.

The charcoal field is `#090d10`; the canonical mark remains `#E42528`. Square assets center the
mark at 75% of the canvas, reproducing the recovered safe-area raster composition. This is the
single opaque icon choice for light, dark, and tinted Home Screen contexts. The generated manifest
at `assets/brand/generated-assets.json` records every output hash and renderer setting.

The generation and immediate `--check` second pass were byte-identical on 2026-07-27. The 1024px
iOS and App Store icons are 8-bit RGB with no alpha. Splash/header marks retain alpha. Physical
iPhone light, dark, tinted, splash, and mask inspection remains a release acceptance item.
