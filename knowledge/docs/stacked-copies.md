# Stacked copies

Find parts that sit exactly on top of an identical copy of themselves, drawn twice, and remove the extra ones.

Some files hold the same part twice, in the same place. From a distance nothing looks wrong. But the two surfaces lie on each other, so the screen flickers where they meet, because the graphics card cannot tell which one is in front. And the triangles are stored and drawn twice. Stacked copies finds these parts and keeps one of each.

Ten identical bolts in ten different places are not stacked copies. Only parts in the same place count.

## Open the card

Press `Ctrl + K` to open the search, type `stacked`, and choose **Find stacked copies…**. The card opens over the viewport, at the bottom left, like [Split](meshoptimiser://docs/split) and [Remove holes](meshoptimiser://docs/fill-holes). `Esc` puts it away.

## Steps

1. Open the card **Stacked copies** as above.
2. Set **Same place within**. The slider goes from 0 to 5 percent of the part’s size, and starts at 0.5. At 0 the parts must lie almost exactly on each other. A higher value also accepts copies that are a little off.
3. Switch on **Also near copies** if the copies may differ a little. Off, two parts count as copies only when they have the same number of triangles. On, the number may differ by up to a quarter, as with another export of the same part, or a copy that was rebuilt with a different mesh.
4. Press **Find stacked copies**.
5. The extra copies are selected, and a line says how many, for example “6 extra copies of 6 parts selected; the first of each is kept”. The part that was loaded first stays. If there are none, it says “No stacked copies found”.
6. Press **Isolate** to look at the extra copies on their own. Check them.
7. Press **Delete** to remove them.

> The command only selects. Nothing is deleted until you press **Delete**.

## Good to know

- Hidden parts are not looked at. Show all parts first (`Alt + H`).
- The card remembers **Same place within** and **Also near copies** for next time.
- Faces that lie exactly on each other still flicker in the viewport. This card is the way to find the parts that cause it.

## Undo

Selecting changes nothing. The delete is one undo step: `Ctrl + Z` brings the copies back.

Related: [select-hidden-parts](meshoptimiser://docs/select-hidden-parts), [cleanup](meshoptimiser://docs/cleanup), [delete-small-parts](meshoptimiser://docs/delete-small-parts), [workflow](meshoptimiser://docs/workflow)
