# Ford Robotics Building model reference

This procedural model is an authored, low polygon interpretation of the Ford
Motor Company Robotics Building in Ann Arbor. It does not bundle or fetch the
official 3D file.

## Primary 3D reference

- Michigan Robotics facility page: <https://robotics.umich.edu/about/facilities/ford-robotics-building/>
- Embedded model link: <https://sketchfab.com/3d-models/u-m-ford-motor-company-robotics-building-8b228b54b3bc4ccfa75c5d8cb872b4da>
- Sketchfab model ID: `8b228b54b3bc4ccfa75c5d8cb872b4da`
- Sketchfab title: **U-M Ford Motor Company Robotics Building**
- Sketchfab author: **The University of Michigan** (Enterprise account)
- Published: January 18, 2021 (the public page currently displays the age of
  the upload as six years)
- Public viewer statistics observed on October 8, 2026: approximately
  1.8 million triangles and 870.6 thousand vertices.

The model thumbnail/viewer was inspected directly. Its exterior cues used by
the procedural recreation are the broad curved glazed collaboration face with
vertical mullions, dark upper horizontal screen/louver massing, recessed
brick/dark side volumes with horizontal slot windows, a flat roof cap with
small raised service masses, pale entry/forecourt wings, and a shallow
landscape/sidewalk surround. The official facility photos on the same page
were used only as a secondary check on the curved facade and upper screen.

## Download and license status

The public Sketchfab page displayed no **Download 3D Model** control and no
Creative Commons or other redistributable license label. It identifies the
upload as an Enterprise model by The University of Michigan. The embedded
viewer also reported that the model was too heavy for the inspection device;
no hidden viewer asset endpoint was used.

Because the public page does not grant clear permission to download,
redistribute, or embed the source geometry in this project, no model archive,
texture, screenshot, or extracted viewer asset is included here. The
procedural code is based on the visible reference only. Any future use of the
source mesh requires written permission or a clearly applicable license from
the rights holder.

## Measurements and bounds

The facility page gives the building's program facts (opened in 2021, four
stories, and 134,000 square feet), but it does not publish a verified exterior
width, depth, height, or facade radius in the linked model page. Therefore the
scene dimensions are deliberately normalized and should not be read as feet or
an architectural survey.

The current Ann Arbor world entry supplies `width: 28`, `depth: 20`, and
`height: 14` scene units. `createFordRobotics()` preserves those declared
dimensions as `group.userData.bounds`; the authored geometry is kept inside
that collision/rendering envelope. The dimensions are suitable for the
compressed browser scene and collision checks only, and are not a claim about
the real building's measured footprint.

No new local model asset was added.
