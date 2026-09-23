# Concept image prompts and review

Generated September 19, 2026 using built-in image generation. These are pre-build concept references, not implemented screens, runtime assets or performance evidence.

## Storm

Output: afterlight-storm.png

Use case: ui-mockup with a crafted stylized 3D game environment.
Create a high-quality landscape 16:9 design reference for AFTERLIGHT, a browser-based single-screen storm recovery game. This is a concept image, not an implemented application.
Composition: full application viewport, no computer/device frame. Thin charcoal top bar, a large orthographic three-quarter coastal tabletop district filling the central and left 76% of screen, narrow quiet right inspector, slim bottom event timeline. Practical readable UI with generous spacing; the diorama is the hero, not dashboard cards.
Scene: ten small functional buildings/nodes maximum, a compact walkable coastal district on a raised physical-model plinth with visible edge: brick apartments, small clinic, depot, two electrical substations, pumping station, harbor beacon, low seawall and blue-gray water. Authored roads, a few trees, two miniature utility vans. Sophisticated miniature architecture, carefully composed readable silhouettes, tactile wet concrete, brick, painted metal and restrained reflections. Plausible achievable Three.js art direction, not hyperdense cinematic open world.
State: storm has interrupted power. Most windows dark, clinic on amber backup and selected with a subtle amber ground ring. A highlighted amber dependency path links it to an interrupted substation. One van waits near depot, another at a road junction. Sparse rain, storm-blue ambience, subtle warm worklights. No fires, explosions, destruction spectacle or floating holograms.
UI palette: background #11191E, panel #1B262D, text ivory #E8E5DA, muted gray #A6B4B7, amber #DFAC60. Restrained humanist sans typography, tiny monospace metadata. Text is legible, few words. Header text exactly "AFTERLIGHT"; secondary "Storm 01" and "PAUSED". Inspector text exactly "Clinic", "Backup power", "Upstream fault", a button "Dispatch crew". Bottom controls "Inspect", "Repair", "Restore", plus a short event strip. Small footer "CONCEPT — NOT IMPLEMENTED".
Lighting: cool overcast scientific model photography with warm practical pools of light, soft shadows, no heavy bloom. Clear material detail without excessive micro clutter. City readable at a glance; UI stays subordinate.
Avoid neon, purple gradients, sci-fi, stock illustration, glossy SaaS cards, fake performance figures, excessive labels or extra text. Render one cohesive polished screen.

## Recovery

Output: afterlight-recovery.png
Edit reference: afterlight-storm.png

Use case: precise-object-edit and lighting-weather. Input image is the AFTERLIGHT storm-state UI concept. Make a SECOND design reference of the SAME screen midway through recovery. Preserve exact camera, district geography, buildings, roads, harbor, two vans, scale and all UI panel positions. No new buildings or redesigned architecture.
Change only these story states: the clinic has normal restored electricity with warm windows, a subtle teal selection ring and teal dependency path to repaired Substation A. Roughly half the apartment windows now warmly lit; the far housing group remains dark. One crew van now parked at Substation A, the other remains near depot. Storm easing, still evening with cool ambient light and wet roads. Calmer water with less foam; restrained rain. Maintain premium tactile miniature materials.
Change right inspector to "Clinic" with "Power restored"; status "Next: reconnect housing"; amber warning "Limited feeder capacity"; button "Inspect feeder". Supporting sentence "Restore the next block without exceeding capacity." Keep a concise two-item dependency list, no fabricated metrics. Remove the generic slogan from upper right; leave that space quiet. Header remains "AFTERLIGHT", "Storm 01", "PAUSED". Bottom strip shows short events "Fault repaired" and "Clinic restored" and actions "Replay", "Compare", "Continue". Keep footer "CONCEPT — NOT IMPLEMENTED".
This is an editable target image, preserve the composition and geographic identity strictly. A believable browser game reference, not a real app screenshot. No cyberpunk, extra prose or excessive bloom.

## Visual review notes

Planning update, September 19: the prompts above are preserved as generation provenance, not runtime requirements. [Storm 01](../../specs/first-playable/scenario.md) controls service loads, 6 → 13 CU staged capacity, repair timing and the actual initial state. Images remain visual references only. Blocked roads, flooding mechanics and flooding events are excluded from the entire first release. Runtime service lighting must track actual grid/backup/offline state; feeder repairs alone do not reconnect or relight services. Completed history must contain only actual events through the current replay cursor in the selected branch.

Both outputs inspected in full. Camera, coastline and main building placements are substantially consistent; the repaired path, van position and apartment lights communicate recovery.
These are mood/composition references, not pixel-perfect specifications:
- The storm image has more live lights (including the beacon) than the intended outage; runtime building lights must reflect actual state, not this generated arrangement.
- Small autogenerated text, especially timeline times and “Reports of flooding,” is illustrative only. No flooding mechanic or preset event timing was approved.
- Storm image's extra header slogan is not approved product copy.
- Ocean foam, dense masonry and foliage are ambitious render detail, not guaranteed first-release features.
- The recovery path is brighter/more saturated than the design tokens; implementation should keep selected paths restrained.
- A clinic image inside the inspector is optional and must not require a costly second live render view.
- Implement an explicit distinction between current history and scheduled/forecast events; never present future events as completed history.
- Generated snippets should be rewritten from actual state. Specs override image details.

Files were copied into the project; original generations remain preserved.
