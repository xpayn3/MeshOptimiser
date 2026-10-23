# Photo mode

Draw the model the slow, pretty way, with studio light, a soft floor shadow and a few picture effects, and save a PNG up to four times the size of the view.

Photo mode is for pictures, not for working. It lights the model with the loft studio, turns the shadows on, hides the grid and the origin marker, and draws the view with smoother edges and a few effects. It is slower than the normal view, so it starts off, and it is not saved with the scene.

1. Open the **Photo mode** card in the right sidebar and switch **Photo mode** on, or choose **Photo mode** in the command search (`Ctrl + K`).
2. Orbit to the angle you want. The model stands on a round, softly lit disc that catches its shadow.
3. Set **Quality**, and switch the effects you want on or off.
4. Choose **Saved size**, then press **Save photo**. You can also choose **Save a photo of the model** in the command search. The picture is a PNG.
5. Switch **Photo mode** off to go back to the normal view. The background and the light you had before come back (a picture you loaded yourself as the light is not brought back).

## What the controls do

- **Floor disc**: The round disc under the model that catches its shadow. Off: the model hangs in the studio light with no floor and no floor shadow.
- **Quality**: How smooth the edges are, and how many samples the occlusion and the glow take. Lower it if the view is slow with Photo mode on.
- **AO**: Ambient occlusion: darkens creases and places where parts meet.
- **Glow**: Bright highlights bleed a little light around themselves.
- **Lens fringe**: A trace of colour split towards the corners.
- **Vignette**: Darkens the edges of the picture.
- **Film grain**: A little noise that takes the digital edge off smooth shading.
- **Saved size**: The pixel density of the saved PNG, as a multiple of the size of the view, from 1x to 4x. The long side is kept under 8192 pixels.

Each effect has its own switch and a number you drag or click to type. An effect that is off is left out of the picture and costs nothing.

## The toolbar

The camera at the foot of the tool pill on the left switches Photo mode on and off. While it is on, a floating pill takes the place of the bottom toolbar: **Leave**, **Lights**, **Backdrop**, **Look** and **Quality** (each button names what is chosen, and a click lists the others), **Effects** (a panel with the floor disc, the softboxes, every effect’s switch and bar, and the focus), the size of the saved picture, and **Save photo**. The left sidebar folds away while Photo mode is on and opens again when you leave it. Edit mesh is not available in Photo mode.

## The lens rings

With depth of field on, `Ctrl` + click on the model sets the focus there. Hold `V` over the view and a lens’s three rings appear at the pointer: focus, aperture (f/1.4 to f/16, how strong the depth of field is) and zoom (the lens in millimetres). Move the pointer up or down to turn the ring that is lit, and turn the wheel to go from one ring to the next. The rings hold for a moment on round distances, stops and classic lenses; hold `Shift` to turn them finely. The rings tick and click as they turn; **Settings**, **General**, **Sound**, **Interface sounds** switches those sounds off, here and in the quick wheels.

**Softboxes** hangs four bright panels in the studio, so metal and gloss reflect clean streaks along their curves. Switch it off for the plainer reflection.

> Photo mode is not saved with the scene, and it starts off every time. For a quick picture of the normal view, use [Screenshots](meshoptimiser://docs/screenshots).

Related: [screenshots](meshoptimiser://docs/screenshots), [view-modes](meshoptimiser://docs/view-modes), [colours-materials](meshoptimiser://docs/colours-materials)
