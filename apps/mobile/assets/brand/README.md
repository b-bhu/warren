# Warren mobile branding

`approved/` contains the original downloaded artwork from the final design-token
asset message in **Warren Demo Story Brief**, dated 24 September 2026. Those files
are preserved byte for byte. See its `Warren_Assets_README.md` for the original
usage guidance; that guide describes the complete kit, including files that were
not downloaded. The imported collection contains 9 SVGs, 20 PNGs, and that guide.

`derived/` contains only mechanical mobile exports. No paths were redrawn, no
wordmark was re-typeset, and no missing composition was reconstructed.

## Runtime surfaces

- `app.json`: default Expo/Android icon, iOS light/dark icons, Android adaptive
  foreground/background/monochrome, light/dark native splash, and the existing
  Expo web favicon. Android's native primary/task-switcher accent uses the
  existing light-theme proof color (`#0B5C78`). There is no separate website change.
- `BrandLogo`: the original transparent horizontal PNGs, bundled through literal
  `require` calls. A 126 × 41.14 point box preserves the 1960:640 aspect ratio.
  The component follows the current theme; decorative instances leave labeling
  to their parent button. The outlined wordmark has no font dependency.
- Home, Markets, and Portfolio headers; the shared MarketHeader when it shows
  the home brand; and the full-screen sign-in/preparing/ready/recovery/error
  header use that lockup. Existing Home/Markets navigation actions, Portfolio
  account controls, 44 point button heights, and Back controls remain.
  Portfolio's brand is a static image; its previous button had no action.
- The existing app theme follows the system (`userInterfaceStyle: automatic`).
  Navigation, the root view, native root background, and status bar use existing
  design tokens. Native splash is dismissed at the first root layout, with no
  artificial delay. The fixed dark sign-in design uses the dark-background logo
  and light status-bar content, including when the rest of the app is light.

## Derived files and sources

Paths in the source column are relative to this directory. Output paths are
relative to `derived/`. `derived/manifest.json` records source/output SHA-256
hashes, dimensions, alpha-channel presence, and each exact operation.

| Output | Approved source | Operation / use |
| --- | --- | --- |
| `icons/app-icon-light.png` | `approved/icons/icon-square-light.png` | Keep 1024 × 1024 and the entire composition; flatten on `#F3F5F2` and remove alpha. iOS default/light icon. |
| `icons/app-icon-dark.png` | `approved/icons/icon-square-dark.png` | Keep 1024 × 1024 and the entire composition; flatten on `#131918` and remove alpha. Expo/Android default and iOS dark icon. |
| `android/adaptive-foreground.png` | `approved/brand/mark-dark.svg` | Rasterize the 1024 square SVG canvas at 780 × 780; add 150 transparent pixels per side for a 1080 square layer. Used for both foreground and monochrome (the same silhouette/alpha). Background is the solid `#131918` configured in `app.json`. |
| `splash/splash-light.png` | `approved/brand/mark-light.svg` | Rasterize at the original 1024 × 1024, preserving transparency and placement. Native light splash over `#F3F5F2`. |
| `splash/splash-dark.png` | `approved/brand/mark-dark.svg` | Rasterize at the original 1024 × 1024, preserving transparency and placement. Native dark splash over `#131918`. |
| `web/favicon.png` | `approved/icons/icon-square-dark.png` | Resize to 64 × 64, flatten on `#131918`, and remove alpha. |

The adaptive character fits inside the central 660 px circle of the 1080 px
layer, including antialiasing (66 dp of 108 dp). This is checked by the generator.
No rounded mask or background is baked into the foreground. Android applies the
launcher mask and themed-icon color itself; reusing the foreground as monochrome
avoids an identical duplicate. A background PNG is unnecessary for a solid color.

Both native splashes use `imageWidth: 180` and `resizeMode: contain`. The installed
Expo 57 splash plugin centers the Android image in its 288 dp canvas. The
generator verifies that all visible pixels fit the 192 dp diameter safe circle.
The original portrait `splash-name-light` is intentionally not a system splash:
it has a full-screen composition and wordmark that would be cropped by Android.

## Regeneration

Run `node apps/mobile/scripts/generate-brand-assets.cjs` from the repository root
with **Sharp 0.35.4** available in the development tool environment. For an external
tool installation, set `NODE_PATH` to its `node_modules` directory. Sharp is not a
runtime dependency and generation is not part of app startup or native builds.
The checked-in PNGs are ready for Expo. The script also writes the provenance
manifest and asserts the adaptive/splash safe zones.

## Platform limits and missing source exports

- iOS receives opaque RGB PNGs without baked-in rounded corners, with separate
  light and dark appearances through Expo 57's `ios.icon` object. No custom
  tinted icon or layered Icon Composer artwork was supplied; those are not
  invented here. Launcher appearance support depends on the iOS version.
- Android uses the dark-palette adaptive icon by default. Expo's adaptive-icon
  configuration provides one foreground/background pair, not automatic light and
  dark launcher variants. The monochrome layer supports compatible themed-icon
  launchers. App and splash themes still follow the system.
- The original Android resource archive/adaptive layers were absent. The
  mechanical exports above supply the required native assets through Expo's
  plugins; no manually maintained `android/` or `ios/` tree is added.
- The import still lacks `icon-rounded-light.png`, dark named-splash SVG/PNG,
  original mark PNGs, square-icon SVGs, 512 px exports, canvas-backed logos, and
  original native/symbol splash exports. None is required by the configured
  runtime paths. Missing presentation assets have not been recreated.
- Unused Expo starter components and older `v1` source images remain archived in
  their existing locations. No active screen or app configuration uses their
  brand marks. Provider-hosted wallet approval branding is outside local image
  bundling; its existing identity configuration is unchanged.

## Manual QA after rebuilding

Native assets/configuration require **new Android and iOS binaries**; an OTA JS
update or Metro reload is insufficient. This repository ignores generated native
directories. Use its normal Expo prebuild/EAS process so the updated config is
applied; an existing generated native tree must be regenerated/synced first.
Verify launch screens in an installed release build, not Expo Go's own splash.

The main Warren checkout already has `apps/mobile/android`. From its root,
sync the new resources into that existing tree without cleaning it, then build
and install to the connected Android device:

```sh
pnpm --dir apps/mobile exec expo prebuild --platform android --no-clean --no-install
pnpm android
```

The repository's `pnpm android` script invokes `expo run:android`. No EAS build
configuration is present in this checkout. For a configured iOS development
host, the root `pnpm ios` script invokes `expo run:ios` and can create its absent
native directory.

1. Android: inspect launcher/app-drawer icons with circular and rounded-square
   masks. On a supporting Android 13+ launcher, toggle themed icons and confirm
   the hair/glasses cutouts remain visible and the character is not clipped.
2. Android and iOS: fully terminate and cold-launch in light and dark system
   modes. Confirm the matching canvas/character colors, centered uncropped
   symbol, and clean transition into the first screen without a white/navy flash.
   Repeat while offline; branding must not depend on a network request.
3. iOS: inspect the default/light and dark Home Screen icons where supported;
   check for opaque backgrounds and correct system rounding. Tinted appearance
   uses the platform fallback, not a custom supplied tinted asset.
4. Visit Home, Markets, Portfolio, and full-screen sign-in (including its
   loading/error/recovery states). Toggle system appearance while open; logos
   must remain legible. Check status-bar contrast entering and leaving the
   fixed dark sign-in surface. The separate sign-in sheet retains its own
   current heading and controls.
5. At a narrow phone width and larger text size, check header spacing and
   account controls. With VoiceOver/TalkBack, each Home/Markets brand button
   should be announced once with its action; the static Portfolio and
   full-screen sign-in logos should announce “Warren”. Confirm Home/Markets
   scroll-to-top, Portfolio navigation, and Back controls still work.

## References

- [Expo SDK 57 configuration](https://docs.expo.dev/versions/v57.0.0/config/app/)
- [Expo SDK 57 splash screen](https://docs.expo.dev/versions/v57.0.0/sdk/splash-screen/)
- [Android adaptive icon layers and safe zones](https://developer.android.com/develop/ui/compose/system/icon_design_adaptive)
- [Android splash-screen dimensions](https://developer.android.com/develop/ui/views/launch/splash-screen)

Implementation was also checked against the installed `expo@57.0.22` and
`expo-splash-screen@57.0.9` plugin source and types.
