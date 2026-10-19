# Round parts: Fill round grooves, Fill solid round, Belt

Rebuild a turned part (a spool, a bushing, a pulley) clean from its profile, with its ridges and grooves filled. A fan or a gear can be made one solid round shape, and a drive belt loses its ribs.

A turned part is one profile spun round an axis. Its ridges and grooves cost many triangles and show little from a distance. These commands find the axis by themselves, work on the profile, and spin it round again, so the part comes out closed, smooth round the axis and with far fewer triangles.

- **Fill round grooves**: Fills the ridges and grooves of a round part flush with the ridge tops. Steps, lips, chamfers, wide recesses and the bore stay exactly as they were. The part keeps its number of segments round the axis.
- **Fill solid round**: For a part that is round only in steps, or whose mesh has gaps: a fan with fins, a clutch with cooling ribs, a gear. It is made one solid round shape that fills its whole outline, fins and the room between them included. A good stand-in seen from a distance.
- **Belt: remove ribs**: For a band carried round a closed path in one plane: a poly-V drive belt, a flat belt, a seal strip. The ribs or grooves along the band are filled and the belt is swept again from one cross-section.

## How to use them

1. Select the round parts.
2. Open the command search (**Ctrl + K**) and run **Fill round grooves**, **Fill solid round** or **Belt: remove ribs**.
3. The view switches to Wireframe and the **Round part** card opens. **Segments around** sets how many facets go round the axis. **Smooth up to** sets which edges are shaded smooth. Each change shows at once.
4. Press **Done** or `Esc`. The view goes back to how it was. One undo step (**Ctrl + Z**) takes the part back.

> A part that is not round round one axis is left as it was, with the reason: bolt holes in a flange, a flat or a key way would be lost if it were spun. A belt that is not flat enough, or too thick for its length, is refused the same way.

Related: [voxel-remesh](meshoptimiser://docs/voxel-remesh), [simplify-round-faces](meshoptimiser://docs/simplify-round-faces), [smart-fit](meshoptimiser://docs/smart-fit)
