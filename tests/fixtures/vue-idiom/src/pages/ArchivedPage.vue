<script lang="ts" setup>
import AppShell from '@/components/AppShell.vue'
import Table from '@/ui/table.vue'
</script>

<template>
  <AppShell title="Archived">
    <div class="archived">
      <Table />
    </div>
  </AppShell>
</template>

<style scoped>
.archived { display: grid; gap: var(--space-2); }
</style>
