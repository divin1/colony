<script setup lang="ts">
import DefaultTheme from "vitepress/theme";
import InstallCommand from "./InstallCommand.vue";
import VersionBadge from "./VersionBadge.vue";

const { Layout } = DefaultTheme;
</script>

<template>
  <Layout>
    <template #home-hero-info-before>
      <VersionBadge />
    </template>
    <template #home-hero-actions-after>
      <InstallCommand />
    </template>
  </Layout>
</template>
