<script context="module" lang="ts">
  // Real Svelte 4: a module-context block that exports a load function as a default.
  // It looks like the Options API to a pattern written for Vue, and it is not one.
  export default { prerender: true }
</script>

<script lang="ts">
  export let rows: string[] = []
</script>

<ul class="list">
  {#each rows as row}
    <li>{row}</li>
  {/each}
</ul>

<style>
  .list { gap: var(--space-2); }
</style>
