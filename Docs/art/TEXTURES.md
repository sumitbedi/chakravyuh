Generated with the built-in image_gen tool for Chakravyuh. No game code changed.

wall.png: warm red-ochre weathered sandstone running-bond blocks with faint lotus/temple relief, orthographic, flat even albedo lighting, no text or people.
floor.png: darker worn grey-brown rectangular stone flagstones, overhead, flat even albedo lighting, no text or people.

Both prompts requested seamless wrapping on both axes and no cast shadows, highlights, vignette, or perspective. Floor received an image_gen seam repair pass. Final textures were resized to 512 square; a smooth symmetric 12-pixel perimeter match enforces identical opposing border pixels. Interior content remains generated artwork.

Verification: Pillow assertions passed for PNG format, exact 512x512 dimensions, identical left/right and top/bottom border pixels, and lower mean luminance for floor. See texture-checks.json for measured results. Identical edge pixels do not prove natural-looking material repetition.

Claude visual QA: inspect wall-offset-check.png and floor-offset-check.png, which shift each tile by 256 pixels on both axes to expose wrap boundaries at the center. Also repeat each texture in a 3x3 grid and check in-game at 390px width. Review seam blending, mortar continuity, relief strength, and lighting before shipping.

Recheck dimensions: `sips -g pixelWidth -g pixelHeight -g format wall.png floor.png`
