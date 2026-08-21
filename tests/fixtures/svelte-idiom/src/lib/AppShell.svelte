<script lang="ts">
  export let title: string
</script>

<main class="shell">
  <h1>{title}</h1>
  <slot />
</main>

<style>
  .shell { padding: var(--space-4); }
</style>
