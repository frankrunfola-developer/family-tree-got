/* -------------------------------------------------------------------------
  File:    avatar-config.js
  Purpose: Centralized avatar/circle fitting rules for Tree + Map
  Author:  Frank Runfola
  Date:    01/03/2025
------------------------------------------------------------------------- */

export const AVATAR = {
  // shared “face framing” feel
  objectPosition: "50% 35%",        // Map/HTML images
  svgPreserveAspectRatio: "xMidYMid slice", // Tree/SVG images

  // sizes (CSS will clamp map pins, tree uses explicit px)
  pinSize: { min: 40, idealVW: 7, max: 64 },
};