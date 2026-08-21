<script lang="ts">
  let { name } = $props()
</script>

<section class="detail">{name}</section>

<style>
  .detail { gap: var(--space-2); }
  :global(body) { margin: 0; }
</style>
