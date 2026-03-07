# Iron Sights Readme

The iron sights images are 4 pictures of the various parts of a rifle viewed from the perspective of someone looking down it. The precise pixel on the images targeted is this:

x coordinate: 166
y coordinate: 198

When the player holds shift, we should replace their gun with the 4 layered iron sights images. Make sure 166x198 on the images corresponds with the target reticule in the center of the screen.

In normal play, the player moves the mouse and the reticule moves first, with the camera following shortly after. We will do the same thing with the iron sights, but slightly different.

When the camera and reticule align, the iron sights are lined up as they are in the original images.

When the reticule moves away from the center, all 4 iron sights image layers are going to move differently. 0_front will move the most in the direction of the reticule. The 1_rear will move towards the reticule, but less so. 2_barrel will move slightly away from the reticule, and 3_stock will move away further. This gives the sense of a 3D object with its point chasing the reticule, that is pivoting around its middle (between 1_rear and 2_barrel).
