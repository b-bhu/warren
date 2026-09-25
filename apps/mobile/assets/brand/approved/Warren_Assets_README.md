# Warren assets — matched to the application tokens

All images are separate production files. There is no collage in this kit. The approved character silhouette and outlined Warren wordmark are unchanged; only the palette and requested export shapes vary.

## Palette

| Theme | Background: Colors[theme].canvas | Artwork: Colors[theme].ink |
| --- | --- | --- |
| Dark | #131918 | #F2F5F1 |
| Light | #F3F5F2 | #17211F |

The names `dark` and `light` describe the target application theme. Transparent `brand-dark` and `mark-dark` therefore have light artwork. The supplied `background` and `surface` tokens were not substituted for `canvas`. The source token module is included unchanged in value and free of framework imports.

## Individual files

Each primary asset has its own SVG master and PNG export.

- `brand/brand-dark` and `brand/brand-light`: transparent horizontal logos, 1960 × 640 PNG.
- `brand/brand-canvas-dark` and `brand/brand-canvas-light`: the same logos on the matching canvas color.
- `brand/mark-dark` and `brand/mark-light`: transparent character-only logos, 1024 × 1024 PNG.
- `icons/icon-square-{theme}`: full-bleed launcher master, 1024 and 512 px PNG.
- `icons/icon-rounded-{theme}`: rounded-square image, transparent outside the rounded square; 1024 and 512 px PNG.
- `icons/icon-circle-{theme}`: circular image, transparent outside the circle; 1024 and 512 px PNG.
- `splash/splash-name-{theme}`: 1080 × 2400 portrait composition with the name Warren.
- `splash/splash-native-{theme}`: 1080 × 2400 native-launch composition with just the character.
- `splash/splash-symbol-{theme}`: separate transparent native splash symbol, 1152 × 1152 PNG.
- `small/`: independent 64, 48 and 32 px PNGs for rounded and circle icons in both themes. Open at 100% zoom to assess actual display size.
- `adaptive/`: separate foreground, background and monochrome SVG/PNG resources.

SVGs contain editable vector paths, with no embedded bitmap and no font dependency. Transparent glasses and hair cutouts reveal the surface behind the mark.

## Which icon to use

Use the full-square master or adaptive layers for an installed Android launcher icon. Use the explicitly rounded and circular files where a ready-masked image is needed, such as an avatar, app tile or marketing asset. Do not add a second rounded/circle mask to those files.

The UI radii (`control: 10`, `card: 12`) apply to UI components. They are not used as the launcher mask. The static rounded-square export retains the approved icon proportion; the platform controls native icon masking.

## Android resources

`Warren_Android_Resources.zip` contains the `res/` assets independently. The same tree is also included in the full kit.

- `@mipmap/ic_warren` is the default dark-palette launcher.
- `@mipmap/ic_warren_light` is a light-palette launcher alternative.
- A single monochrome layer supports launcher theming.
- The native splash vector uses `@color/warren_ink`, with `@color/warren_canvas` as its background. Day and night values are provided. If your application uses an explicit theme preference, connect these resources to that preference in the existing app implementation.
- Merge the supplied resources into the application and configure the existing launcher/splash theme. No application code has been modified or device-tested by this export.

For Android's native launch screen, use the separate symbol and a solid canvas background. The portrait `splash-name` composition is the branded layout for a compatible custom splash or an in-app opening view; it is not a drop-in system splash background. Avoid adding an artificial loading delay.

## Documentation

- https://developer.android.com/develop/ui/compose/system/icon_design_adaptive
- https://developer.android.com/develop/ui/views/launch/splash-screen

The existing wordmark outlines are retained from the approved kit. Exported 24 September 2026.
