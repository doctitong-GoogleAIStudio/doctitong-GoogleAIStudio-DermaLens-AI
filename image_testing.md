# Image Integration Testing Rules

## Image Handling Rules
- Always use base64-encoded images for all tests and requests.
- Accepted formats: JPEG, PNG, WEBP only.
- Do not use SVG, BMP, HEIC, or other formats.
- Do not upload blank, solid-color, or uniform-variance images.
- Every image must contain real visual features (objects, edges, textures, shadows).
- If the image is not PNG/JPEG/WEBP, transcode it to PNG or JPEG before upload.
  - Re-detect and update the MIME after transformations.
- If the image is animated (GIF, APNG, WEBP animation), extract the first frame only.
- Resize large images to reasonable bounds (avoid oversized payloads).

## Endpoint under test
`POST /api/analyze` (requires `Authorization: Bearer <token>`)
Body: `{ "images": ["<base64 or data-uri>", ...] }` (1–6 images)
Returns the Diagnosis JSON: imageQuality, mostLikelyDiagnosis, differentialDiagnoses, nextSteps, disclaimer.
Model: gemini-3.1-pro-preview, called server-side with GEMINI_API_KEY.
