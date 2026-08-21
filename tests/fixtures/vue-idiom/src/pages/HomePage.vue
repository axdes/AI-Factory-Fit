<script lang="ts" setup>
import AppShell from '@/components/AppShell.vue'
import Heading from '@/ui/heading.vue'
</script>

<template>
  <AppShell title="Home">
    <div class="home">
      <Heading>Home</Heading>
    </div>
  </AppShell>
</template>

<style scoped>
.home { display: flex; gap: var(--space-2); }
</style>
