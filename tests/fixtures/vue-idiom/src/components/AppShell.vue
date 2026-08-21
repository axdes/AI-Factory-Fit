<script lang="ts" setup>
interface Props {
  title: string
}

const props = defineProps<Props>()
</script>

<template>
  <main class="shell">
    <h1>{{ props.title }}</h1>
    <slot />
  </main>
</template>

<style scoped>
.shell { padding: var(--space-4); }
</style>
