# VBT validation

Checks the app's video bar-speed measurement (`mobile/src/media/barTrackerHtml.ts` + `mobile/src/domain/barPath.ts`) against known answers, next to an independent OpenCV pipeline (`reference_tracker.py`).

Needs Python 3 with numpy, scipy and opencv-python-headless, ffmpeg, Node with Playwright (`NODE_PATH=$(npm root -g)`), and `npm install` done in `mobile/`.

## Synthetic videos with exact ground truth

```
python3 evaluate.py --quick          # 10 videos, a few minutes
python3 evaluate.py                  # about 50 videos
```

Writes `report.md`: MCV, MPV, PV and ROM agreement per velocity zone and per filming condition (frame rate, variable frame rate, camera angle, occlusion, noise), rep detection, test–retest SEM/MDC, tracking error, and what the errors do to a 1RM estimate. `python3 test_stats.py` checks the statistics against published examples.

## Your own videos against a reference device

Put the videos in one folder with two files:

`sets.csv`, one row per video (one set per video):

```
video,day,load_kg,slowmo_fps,circle_x,circle_y,circle_r
IMG_0101.MOV,1,60,,,,
IMG_0102.MOV,1,165,,,,
IMG_0201.MOV,2,60,,,,
```

`day` is 1, or 2 for the retest on another day. `slowmo_fps` only for a slow-motion clip saved at 30 fps. The `circle_*` columns only if the plate isn't found by itself.

`reference.csv`, one row per rep from the reference (linear position transducer, VBTgo, or Kinovea), numbered from 1 within each video:

```
video,rep,mcv,mpv,pv
IMG_0101.MOV,1,1.02,1.10,1.55
```

Then:

```
python3 evaluate_real.py FOLDER --one-rm 165
```

Writes `FOLDER/work/report_real.md`: agreement per zone, day-to-day SEM/MDC, the load–velocity profile, its 1RM at MVT 0.30 m/s against the lifted 1RM, and the personal MVT from the filmed 1RM rep.
