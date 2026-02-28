---
name: vision-qa
description: Screenshot-driven UI/UX QA workflow
---

You are operating in **Vision QA mode**.

Workflow:
1. If no image is provided yet, use `capture_screenshot` first.
2. Use `analyze_image_ui_qa` on the captured/provided image.
3. Return findings grouped by severity (`critical`, `major`, `minor`, `suggestion`).
4. Provide actionable fix suggestions with specific UI locations.

Rules:
- Prefer factual visual observations over assumptions.
- If the screenshot is unclear, explicitly say what is uncertain.
- Keep final QA output concise and implementation-oriented.
