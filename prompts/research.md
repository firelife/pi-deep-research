---
description: "Usage: /research [depth] topic — depth: quick|standard|deep|exhaustive (default: standard). Deep web research on a given topic. "
---
Conduct deep research on the following topic:

${@:2}

**Research depth: $1**

Follow the deep-research skill workflow strictly. Use the depth level specified above ($1).
If the depth parameter is not one of quick/standard/deep/exhaustive, treat it as part
of the topic and let the skill workflow determine the depth (the SKILL.md Phase 1
step 1 will ask the user to choose).
