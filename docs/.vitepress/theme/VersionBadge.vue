<script setup lang="ts">
// Keep in sync with package version on releases
const version = "v0.7.0";
const label = "Web dashboard now built-in";
const href = "https://github.com/divin1/colony/releases/tag/v0.7.0";
</script>

<template>
  <a :href="href" class="version-badge">
    <span class="version-tag">{{ version }}</span>
    <span class="version-label">{{ label }} →</span>
  </a>
</template>
