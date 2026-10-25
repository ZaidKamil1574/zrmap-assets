# z/R Map Reality website (www.zrmap.com)

This branch holds the live 3D home page for www.zrmap.com and its models. The Wix site loads `zrmap-site/index.html` through jsDelivr, pinned to a commit.

- `index.html`: the scroll-driven 3D page
- `earth.glb`, `trees.bin`: the low-poly Earth
- `city_*.glb`: Los Angeles, Toronto, Doha and London skylines
- `env.js`: the realistic city view, which streams Google Photorealistic 3D Tiles (the key is set in `index.html`)
- `bmo-promo.mp4`: the Los Angeles media player video
- `bmo.glb`: BMO Stadium (from the 3D scan), `st_*.glb`: Dodger Stadium, BMO Field, Education City Stadium
