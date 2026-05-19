<script setup lang="ts">
import { ref } from "vue";

const copied = ref(false);
const cmd = "curl -fsSL https://raw.githubusercontent.com/divin1/colony/main/install.sh | sh";

function copy() {
  navigator.clipboard.writeText(cmd).then(() => {
    copied.value = true;
    setTimeout(() => (copied.value = false), 2000);
  });
}
</script>

<template>
  <div class="install-command">
    <code class="install-text">{{ cmd }}</code>
    <button class="install-copy" :aria-label="copied ? 'Copied' : 'Copy'" @click="copy">
      <span v-if="copied">✓</span>
      <span v-else>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
      </span>
    </button>
  </div>
</template>
